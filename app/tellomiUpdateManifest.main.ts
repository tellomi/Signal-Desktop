// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi（tellomi/tellomi#1399 Desktop 半边，需求 docs/product/specs/app-update-and-version-policy.md §3.2）：
// 主进程读更新清单、判档，变了就告诉每个窗口（`tellomi-update-tier`）；窗口启动时用 `tellomi-update-tier:get` 要一次。
// 检查频率：启动后 30 秒一次，之后每 6 小时；处在「必须」档时每次回到前台都查（节流 1 分钟），服务端撤销后立即放行。
// 每次回到前台也重新判档（`requiredFrom` 到点了，推荐就变成必须）。

import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, net } from 'electron';

import config from './config.main.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import { drop } from '../ts/util/drop.std.ts';
import { linkRegistryFetchInit } from '../ts/linkPreviews/linkRegistryStore.node.ts';
import { verify } from '../ts/updater/curve.node.ts';
import {
  checkForUpdateManifest,
  loadCachedUpdateManifest,
  UPDATE_MANIFEST_CACHE_DIR,
} from '../ts/updater/tellomiUpdateManifest.node.ts';
import {
  desktopBuild,
  evaluateUpdateTier,
  isSameUpdateTierState,
} from '../ts/util/tellomiUpdateManifest.std.ts';
import type {
  UpdateManifest,
  UpdateTierState,
} from '../ts/util/tellomiUpdateManifest.std.ts';

const log = createLogger('app/tellomiUpdateManifest');

const FIRST_CHECK_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FOREGROUND_CHECK_THROTTLE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const UPDATE_TIER_CHANNEL = 'tellomi-update-tier';
const UPDATE_TIER_GET_CHANNEL = 'tellomi-update-tier:get';

let manifest: UpdateManifest | undefined;
let state: UpdateTierState = { tier: 'none' };
let lastCheckAt = 0;
let checking = false;

async function fetchBytes(
  url: string,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  // 同链接注册表：`bypassCustomProtocolHandlers` 不能少（app/protocol_filter 会拒掉默认会话里所有 http(s)）。
  const response = await net.fetch(
    url,
    linkRegistryFetchInit(REQUEST_TIMEOUT_MS)
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    throw new Error('too large');
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.length > maxBytes) {
    throw new Error('too large');
  }
  return body;
}

function publicKey(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    Buffer.from(config.get<string>('updatesPublicKey'), 'hex')
  );
}

function cacheDir(): string {
  return join(app.getPath('userData'), UPDATE_MANIFEST_CACHE_DIR);
}

function reevaluate(): void {
  const next = evaluateUpdateTier(
    manifest,
    desktopBuild(app.getVersion()),
    Date.now()
  );
  if (isSameUpdateTierState(next, state)) {
    return;
  }
  state = next;
  log.info(
    `tier ${state.tier}${state.latestVersion ? ` (latest ${state.latestVersion})` : ''}`
  );
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(UPDATE_TIER_CHANNEL, state);
  }
}

async function checkOnce(): Promise<void> {
  if (checking) {
    return;
  }
  checking = true;
  lastCheckAt = Date.now();
  try {
    const result = await checkForUpdateManifest({
      updatesUrl: config.get<string>('updatesUrl'),
      cacheDir: cacheDir(),
      publicKey: publicKey(),
      deps: { fetchBytes, verify },
    });
    if (result.status !== 'current') {
      log.info(`check ${result.status}`);
    }
    manifest = result.manifest;
    reevaluate();
  } catch (error) {
    // checkForUpdateManifest never throws; this is the last line of defence for the timer.
    log.warn(
      `check failed: ${error instanceof Error ? error.name : typeof error}`
    );
  } finally {
    checking = false;
  }
}

export function startTellomiUpdateManifest(): void {
  try {
    manifest = loadCachedUpdateManifest({
      cacheDir: cacheDir(),
      publicKey: publicKey(),
      verify,
    });
  } catch {
    manifest = undefined;
  }
  reevaluate();

  ipcMain.handle(UPDATE_TIER_GET_CHANNEL, () => state);

  app.on('browser-window-focus', () => {
    reevaluate();
    if (
      state.tier === 'required' &&
      Date.now() - lastCheckAt >= FOREGROUND_CHECK_THROTTLE_MS
    ) {
      drop(checkOnce());
    }
  });

  setTimeout(() => drop(checkOnce()), FIRST_CHECK_MS).unref();
  setInterval(() => drop(checkOnce()), CHECK_INTERVAL_MS).unref();
}
