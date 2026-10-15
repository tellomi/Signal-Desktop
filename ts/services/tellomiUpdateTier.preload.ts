// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import { createLogger } from '../logging/log.std.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import {
  onExpiration,
  tellomiLiftUpdateRequired,
} from '../textsecure/WebAPI.preload.ts';
import { showTellomiUpdateAvailable } from '../shims/showTellomiUpdateAvailable.dom.tsx';
import { openTellomiUpdateRequired } from '../shims/showTellomiUpdateRequired.dom.tsx';
import type {
  UpdateRequiredLayer,
  UpdateRequiredLayerProps,
} from '../shims/showTellomiUpdateRequired.dom.tsx';
import { getBuildUpgradeAction } from '../util/buildExpiration.std.ts';
import { drop } from '../util/drop.std.ts';
import { openLinkInWebBrowser } from '../util/openLinkInWebBrowser.dom.ts';
import OS from '../util/os/osPreload.preload.ts';
import * as Registration from '../util/registration.preload.ts';
import {
  requiredButtonState,
  shouldAutoShowRequiredLayer,
  shouldShowRecommendedCard,
} from '../util/tellomiUpdateManifest.std.ts';
import type { UpdateTierState } from '../util/tellomiUpdateManifest.std.ts';

const log = createLogger('tellomiUpdateTier');

// 和 app/tellomiUpdateManifest.main.ts 的 UPDATE_TIER_CHANNEL / UPDATE_TIER_GET_CHANNEL 一致。
const UPDATE_TIER_CHANNEL = 'tellomi-update-tier';
const UPDATE_TIER_GET_CHANNEL = 'tellomi-update-tier:get';
const DOWNLOAD_PAGE = 'https://tellomi.app/download/';

// Tellomi（tellomi/tellomi#1399 Desktop 半边，需求 app-update-and-version-policy.md §3.4）：主窗口这边的三档。
// 主进程判档（app/tellomiUpdateManifest.main.ts），这里只管界面：
// - 推荐：进首页后弹一次卡片，同一版本只弹一次（tellomiUpdateCardSeenVersion）；
// - 可选：不弹（左栏和设置里现有的「有可用更新 · 点击重启」照旧，「关于」里多一行）；
// - 必须：立即只读（同安卓 UpdateManifests.reconcile：判必须就只读）——停掉连接但留着凭证（SocketManager 的
//   'tellomiUpdateRequired'），左栏红色横幅；盖上阻断页，除非这个 App 版本已经选过「只看聊天记录」
//   （tellomiUpdateReadOnlyChosenVersion）。横幅上的「更新」随时打开阻断页。
// - 撤销（必须档里拿到一份不再判必须的清单）：关掉阻断页、去掉横幅、重新连接；「只看聊天记录」的选择作废，下次再要求时照常弹。
// 本机构建到期（DialogExpiredBuild）和服务端 499 的只读不归这里管，SocketManager 也不让这里的只读盖掉它们。

let isShowingCard = false;
let required: UpdateTierState | undefined;
let layer: UpdateRequiredLayer | undefined;
let unsubscribeLayer: (() => void) | undefined;

function upgrade(state: UpdateTierState): void {
  const { dialogType, didSnooze } = window.reduxStore.getState().updates;
  const action = getBuildUpgradeAction({
    isMAS: OS.isMAS(),
    updateDialogType: dialogType,
    didSnoozeUpdate: didSnooze,
  });
  if (action === 'updater') {
    window.reduxActions.updates.startUpdate();
  } else if (action === 'download-page') {
    openLinkInWebBrowser(state.downloadUrl ?? DOWNLOAD_PAGE);
  }
  // 'none'：正在下载，左栏下面的更新提示（阻断页的按钮）有进度，下完会提示重启。
}

function layerProps(state: UpdateTierState): UpdateRequiredLayerProps {
  return {
    version: state.latestVersion ?? '',
    reason: state.requiredReason ?? 'other',
    notesUrl: state.notesUrl,
    button: requiredButtonState(window.reduxStore.getState().updates),
    // 从没关联过：没有聊天记录可看（只读还会挡住关联用的二维码连接）
    canViewChatsOnly: Registration.everDone(),
    onUpdate: () => upgrade(state),
    onOpenNotes: url => openLinkInWebBrowser(url),
    onViewChatsOnly: () => drop(chooseViewChatsOnly()),
  };
}

function closeLayer(): void {
  unsubscribeLayer?.();
  unsubscribeLayer = undefined;
  layer?.close();
  layer = undefined;
}

function showLayer(state: UpdateTierState): void {
  if (layer) {
    layer.render(layerProps(state));
    return;
  }
  log.info(`showing the update-required page (${state.latestVersion})`);
  layer = openTellomiUpdateRequired(layerProps(state));
  // 下载进度、下载完成（按钮变「重启并更新」）都在 redux updates 里。
  let lastUpdates = window.reduxStore.getState().updates;
  unsubscribeLayer = window.reduxStore.subscribe(() => {
    const { updates } = window.reduxStore.getState();
    if (updates === lastUpdates || required === undefined) {
      return;
    }
    lastUpdates = updates;
    layer?.render(layerProps(required));
  });
}

async function chooseViewChatsOnly(): Promise<void> {
  log.info('view chats only until the update');
  closeLayer();
  await itemStorage.put(
    'tellomiUpdateReadOnlyChosenVersion',
    window.getVersion()
  );
}

/** 左栏红色横幅的「更新」：重新打开阻断页。 */
export function showTellomiUpdateRequired(): void {
  if (required !== undefined) {
    showLayer(required);
  }
}

function enterRequired(state: UpdateTierState): void {
  required = state;
  if (!window.reduxStore.getState().updates.tellomiReadOnly) {
    log.warn(
      `the update manifest requires an update (${state.requiredReason}); read-only`
    );
    window.reduxActions.updates.tellomiSetReadOnly(true);
    drop(onExpiration('tellomiUpdateRequired'));
  }
  const chosenVersion = itemStorage.get('tellomiUpdateReadOnlyChosenVersion');
  if (
    layer ||
    shouldAutoShowRequiredLayer(state, chosenVersion, window.getVersion())
  ) {
    showLayer(state);
  }
}

async function leaveRequired(): Promise<void> {
  if (required === undefined) {
    return;
  }
  required = undefined;
  log.info('the required update was withdrawn; reconnecting');
  closeLayer();
  window.reduxActions.updates.tellomiSetReadOnly(false);
  await itemStorage.remove('tellomiUpdateReadOnlyChosenVersion');
  await tellomiLiftUpdateRequired();
}

async function handleRecommended(state: UpdateTierState): Promise<void> {
  if (isShowingCard) {
    return;
  }
  const seenVersion = itemStorage.get('tellomiUpdateCardSeenVersion');
  if (
    !shouldShowRecommendedCard(state, seenVersion) ||
    state.latestVersion === undefined
  ) {
    return;
  }
  isShowingCard = true;
  try {
    const choice = await showTellomiUpdateAvailable({
      version: state.latestVersion,
      notesUrl: state.notesUrl,
    });
    await itemStorage.put('tellomiUpdateCardSeenVersion', state.latestVersion);
    log.info(`recommended card for ${state.latestVersion}: ${choice}`);
    if (choice === 'update') {
      upgrade(state);
    }
  } finally {
    isShowingCard = false;
  }
}

async function handle(state: UpdateTierState): Promise<void> {
  if (state.tier === 'required') {
    enterRequired(state);
    return;
  }
  await leaveRequired();
  await handleRecommended(state);
}

export function initializeTellomiUpdateTier(): void {
  ipcRenderer.on(UPDATE_TIER_CHANNEL, (_event, state: UpdateTierState) => {
    drop(handle(state));
  });
  drop(handleCurrentTier());
}

async function handleCurrentTier(): Promise<void> {
  let state: UpdateTierState;
  try {
    state = await ipcRenderer.invoke(UPDATE_TIER_GET_CHANNEL);
  } catch {
    // 测试环境和开发里主进程没起这个服务。
    return;
  }
  await handle(state);
}
