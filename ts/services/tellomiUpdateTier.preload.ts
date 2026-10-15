// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import { createLogger } from '../logging/log.std.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { showTellomiUpdateAvailable } from '../shims/showTellomiUpdateAvailable.dom.tsx';
import { getBuildUpgradeAction } from '../util/buildExpiration.std.ts';
import { drop } from '../util/drop.std.ts';
import { openLinkInWebBrowser } from '../util/openLinkInWebBrowser.dom.ts';
import OS from '../util/os/osPreload.preload.ts';
import { shouldShowRecommendedCard } from '../util/tellomiUpdateManifest.std.ts';
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
// - 必须：阻断层（下一步）。

let isShowingCard = false;

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
  // 'none'：正在下载，左栏下面的更新提示有进度，下完会提示重启。
}

async function handle(state: UpdateTierState): Promise<void> {
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
