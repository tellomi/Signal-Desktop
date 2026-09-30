// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { app, clipboard, dialog, shell } from 'electron';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import config from './config.main.ts';
import * as Errors from '../ts/types/errors.std.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import type { LocalizerType } from '../ts/types/Util.std.ts';
import { getAppRootDir } from '../ts/util/appRootDir.main.ts';
import { BUNDLED_LINK_REGISTRY } from '../ts/linkPreviews/bundledLinkRegistry.std.ts';
import { getLinkErrorKind } from '../ts/linkPreviews/linkLog.std.ts';
import {
  LINK_REGISTRY_UPDATE_DIR,
  loadBestLinkRegistry,
} from '../ts/linkPreviews/linkRegistryStore.node.ts';
import { openLinkWithHost } from '../ts/linkPreviews/linkOpenFlow.std.ts';
import type { LinkOpenPlanType } from '../ts/linkPreviews/linkOpenPlan.std.ts';
import { parseLinkOpenPlan } from '../ts/linkPreviews/linkOpenPlan.std.ts';

const log = createLogger('app/linkOpen');

let registry: LinkRegistry | undefined;
let loadFailed = false;

// The bundled registry, or a hot-updated one on top of it (ADR-0063 §8.1 rows 2–3); the same choice the renderer makes.
function loadRegistry(): void {
  try {
    const loaded = loadBestLinkRegistry({
      bundledPath: join(
        getAppRootDir(),
        'build',
        'links',
        BUNDLED_LINK_REGISTRY
      ),
      updateDir: join(app.getPath('userData'), LINK_REGISTRY_UPDATE_DIR),
      publicKey: Buffer.from(config.get<string>('updatesPublicKey'), 'hex'),
      deps: {
        load: envelope => LinkRegistry.load(envelope),
        loadUpdate: (envelope, signatureHex, publicKey, currentVersion) =>
          LinkRegistry.loadUpdate(
            envelope,
            signatureHex,
            publicKey,
            currentVersion
          ),
      },
    });
    registry = loaded.registry;
    loadFailed = false;
    log.info(`loaded ${loaded.source} registry ${registry.version}`);
  } catch (error) {
    // Without a registry, links open the way Signal opens them.
    loadFailed = true;
    log.error(`failed to load the link registry: ${Errors.toLogFormat(error)}`);
  }
}

/** A newer registry was stored: open plans use it from now on. */
export function reloadLinkOpenRegistry(): void {
  loadRegistry();
}

function getLinkOpenPlan(url: string): LinkOpenPlanType | undefined {
  if (!registry && !loadFailed) {
    loadRegistry();
  }
  if (!registry) {
    return undefined;
  }
  try {
    return parseLinkOpenPlan(registry.openPlan(url));
  } catch (error) {
    log.warn(`openPlan failed: ${getLinkErrorKind(error)}`);
    return undefined;
  }
}

// Opens an http(s) link from a message (a card or the text; both end up here, ADR-0063 §4.9); the
// flow itself is in ts/linkPreviews/linkOpenFlow.std.ts.
export async function openExternalLink({
  url,
  i18n,
  window,
}: Readonly<{
  url: string;
  i18n: LocalizerType;
  window: BrowserWindow | undefined;
}>): Promise<void> {
  await openLinkWithHost(url, i18n, {
    getPlan: getLinkOpenPlan,
    ask: options =>
      window
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options),
    tell: options => dialog.showMessageBox(options),
    openExternal: target => shell.openExternal(target),
    copyText: text => clipboard.writeText(text),
  });
}
