// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import { getLinkErrorKind } from './linkLog.std.ts';
import type { LinkOpenPlanType } from './linkOpenPlan.std.ts';
import { getDesktopOpenAction } from './linkOpenPlan.std.ts';

// Same name as the app module that wires this up (app/linkOpen.main.ts): one source in the logs.
const log = createLogger('app/linkOpen');

// What this flow needs from the app around it: the open plan from rust/links' registry, Electron's
// dialogs, shell and clipboard. app/linkOpen.main.ts hands in the real ones; a test hands in
// fakes, which is why the flow does not import them itself.
export type LinkOpenMessageBoxType = Readonly<{
  type: 'warning' | 'info';
  message: string;
  detail?: string;
  buttons?: Array<string>;
  defaultId?: number;
  cancelId?: number;
  noLink?: boolean;
}>;

export type LinkOpenHostType = Readonly<{
  getPlan: (url: string) => LinkOpenPlanType | undefined;
  // A question over the window the link was clicked in.
  ask: (options: LinkOpenMessageBoxType) => Promise<{ response: number }>;
  // A notice, on its own.
  tell: (options: LinkOpenMessageBoxType) => Promise<unknown>;
  openExternal: (url: string) => Promise<void>;
  copyText: (text: string) => void;
}>;

// Opens an http(s) link from a message (a card or the text; both end up here, ADR-0063 §4.9):
// never an `intent:` / `javascript:` / `data:` / `file:` target, a warning first when the domain
// imitates a well-known one (§6.1), and "link copied" if even the browser fails (§5.5). What goes
// to the log is the kind of a failure, never the link or what an error says about it (§6.5).
export async function openLinkWithHost(
  url: string,
  i18n: LocalizerType,
  host: LinkOpenHostType
): Promise<void> {
  const action = getDesktopOpenAction(url, host.getPlan(url));
  if (action.type === 'none') {
    log.warn('not opening a link that is not http(s)');
    return;
  }

  if (action.lookalike) {
    const { response } = await host.ask({
      type: 'warning',
      message: i18n('icu:TellomiLinkOpen__lookalike_message', {
        domain: action.lookalike,
      }),
      detail: action.url,
      buttons: [i18n('icu:TellomiLinkOpen__open_anyway'), i18n('icu:cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      return;
    }
  }

  try {
    await host.openExternal(action.url);
  } catch (error) {
    log.error(`Failed to open url: ${getLinkErrorKind(error)}`);
    if (action.copyOnFailure) {
      host.copyText(action.url);
      await host.tell({
        type: 'info',
        message: i18n('icu:TellomiLinkOpen__link_copied'),
      });
    }
  }
}
