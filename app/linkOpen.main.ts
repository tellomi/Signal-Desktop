// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { clipboard, dialog, shell } from 'electron';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Errors from '../ts/types/errors.std.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import type { LocalizerType } from '../ts/types/Util.std.ts';
import { getAppRootDir } from '../ts/util/appRootDir.main.ts';
import { BUNDLED_LINK_REGISTRY } from '../ts/linkPreviews/bundledLinkRegistry.std.ts';
import type { LinkOpenPlanType } from '../ts/linkPreviews/linkOpenPlan.std.ts';
import {
  getDesktopOpenAction,
  parseLinkOpenPlan,
} from '../ts/linkPreviews/linkOpenPlan.std.ts';

const log = createLogger('app/linkOpen');

let registry: LinkRegistry | undefined;
let loadFailed = false;

function getLinkOpenPlan(url: string): LinkOpenPlanType | undefined {
  if (!registry && !loadFailed) {
    try {
      registry = LinkRegistry.load(
        new Uint8Array(
          readFileSync(
            join(getAppRootDir(), 'build', 'links', BUNDLED_LINK_REGISTRY)
          )
        )
      );
    } catch (error) {
      // Without a registry, links open the way Signal opens them.
      loadFailed = true;
      log.error(
        `failed to load the bundled registry: ${Errors.toLogFormat(error)}`
      );
    }
  }
  if (!registry) {
    return undefined;
  }
  try {
    return parseLinkOpenPlan(registry.openPlan(url));
  } catch (error) {
    log.warn(`openPlan failed: ${Errors.toLogFormat(error)}`);
    return undefined;
  }
}

// Opens an http(s) link from a message (a card or the text; both end up here, ADR-0063 §4.9):
// never an `intent:` / `javascript:` / `data:` / `file:` target, a warning first when the domain
// imitates a well-known one (§6.1), and "link copied" if even the browser fails (§5.5).
export async function openExternalLink({
  url,
  i18n,
  window,
}: Readonly<{
  url: string;
  i18n: LocalizerType;
  window: BrowserWindow | undefined;
}>): Promise<void> {
  const action = getDesktopOpenAction(url, getLinkOpenPlan(url));
  if (action.type === 'none') {
    log.warn('not opening a link that is not http(s)');
    return;
  }

  if (action.lookalike) {
    const options = {
      type: 'warning' as const,
      message: i18n('icu:TellomiLinkOpen__lookalike_message', {
        domain: action.lookalike,
      }),
      detail: action.url,
      buttons: [i18n('icu:TellomiLinkOpen__open_anyway'), i18n('icu:cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) {
      return;
    }
  }

  try {
    await shell.openExternal(action.url);
  } catch (error) {
    log.error(`Failed to open url: ${Errors.toLogFormat(error)}`);
    if (action.copyOnFailure) {
      clipboard.writeText(action.url);
      await dialog.showMessageBox({
        type: 'info',
        message: i18n('icu:TellomiLinkOpen__link_copied'),
      });
    }
  }
}
