// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from 'node:path';
import { app, BrowserWindow, net } from 'electron';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import config from './config.main.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import { drop } from '../ts/util/drop.std.ts';
import { getAppRootDir } from '../ts/util/appRootDir.main.ts';
import { BUNDLED_LINK_REGISTRY } from '../ts/linkPreviews/bundledLinkRegistry.std.ts';
import {
  checkForLinkRegistryUpdate,
  LINK_REGISTRY_UPDATE_DIR,
  loadBestLinkRegistry,
} from '../ts/linkPreviews/linkRegistryStore.node.ts';
import { reloadLinkOpenRegistry } from './linkOpen.main.ts';

const log = createLogger('app/linkRegistryUpdater');

// ADR-0063 §4.7 / §7.3: the link registry is data that can be hot-updated (revoking a provider or dropping it to a
// brand shell takes effect without a release). A few seconds after start, then every six hours.
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const deps = {
  load: (envelope: Uint8Array<ArrayBuffer>) => LinkRegistry.load(envelope),
  loadUpdate: (
    envelope: Uint8Array<ArrayBuffer>,
    signatureHex: string,
    publicKey: Uint8Array<ArrayBuffer>,
    currentVersion: bigint | null
  ) =>
    LinkRegistry.loadUpdate(envelope, signatureHex, publicKey, currentVersion),
};

async function fetchBytes(
  url: string,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await net.fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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

async function checkOnce(): Promise<void> {
  const publicKey = Buffer.from(config.get<string>('updatesPublicKey'), 'hex');
  const updateDir = join(app.getPath('userData'), LINK_REGISTRY_UPDATE_DIR);

  let current: bigint;
  try {
    current = loadBestLinkRegistry({
      bundledPath: join(
        getAppRootDir(),
        'build',
        'links',
        BUNDLED_LINK_REGISTRY
      ),
      updateDir,
      publicKey,
      deps,
    }).registry.version;
  } catch {
    // Not even the bundled registry loads; there is nothing to update.
    return;
  }

  const result = await checkForLinkRegistryUpdate({
    resourcesUrl: config.get<string>('resourcesUrl'),
    current,
    publicKey,
    updateDir,
    deps,
    fetchBytes,
  });
  if (result.status !== 'updated') {
    return;
  }

  reloadLinkOpenRegistry();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('link-registry-updated');
  }
}

async function run(): Promise<void> {
  try {
    await checkOnce();
  } catch (error) {
    // checkForLinkRegistryUpdate never throws; this is the last line of defence for the timer.
    log.warn(
      `check failed: ${error instanceof Error ? error.name : typeof error}`
    );
  }
}

export function startLinkRegistryUpdater(): void {
  setTimeout(() => drop(run()), FIRST_CHECK_MS).unref();
  setInterval(() => drop(run()), CHECK_INTERVAL_MS).unref();
}
