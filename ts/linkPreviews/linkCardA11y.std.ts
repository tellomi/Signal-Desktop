// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalizerType } from '../types/Util.std.ts';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import type { FirstPartyCardDisplayType } from './firstPartyCard.std.ts';

// card-visual §3.6: what a screen reader says for a link card, as one sentence whose parts are
// joined by the language's own separator, and the same words on all three platforms. A part that
// is missing is left out, and a part that only repeats an earlier one is said once.
//
// - a link card to a website: "Link, <title>, <domain>";
// - the card of a Tellomi object: "Tellomi group, <name>, <members>, button: Join Group".
//
// The parts are the ones the card shows (the level rust/links decided, the URL and what this
// device already has), never anything else the sender wrote.

function joinParts(
  i18n: LocalizerType,
  parts: ReadonlyArray<string | undefined>
): string {
  const said: Array<string> = [];
  for (const part of parts) {
    const text = part?.trim();
    if (text && !said.includes(text)) {
      said.push(text);
    }
  }
  return said.join(i18n('icu:TellomiLinkCard__a11y_separator'));
}

export function getLinkCardAriaLabel(
  i18n: LocalizerType,
  {
    title,
    domain,
  }: Readonly<{ title: string | undefined; domain: string | undefined }>
): string {
  return joinParts(i18n, [
    i18n('icu:TellomiLinkCard__a11y_link'),
    title,
    domain,
  ]);
}

function getFirstPartyKindName(
  i18n: LocalizerType,
  type: FirstPartyCardDisplayType['type']
): string {
  switch (type) {
    case 'user':
      return i18n('icu:TellomiLinkCard__tellomi_user');
    case 'group':
      return i18n('icu:TellomiLinkCard__a11y_kind_group');
    case 'call':
      return i18n('icu:TellomiLinkCard__call_title');
    case 'sticker':
      return i18n('icu:TellomiLinkCard__a11y_kind_sticker_pack');
    case 'official':
      return i18n('icu:TellomiLinkCard__official_title');
    default:
      throw missingCaseError(type);
  }
}

export function getFirstPartyCardAriaLabel(
  i18n: LocalizerType,
  card: FirstPartyCardDisplayType
): string {
  return joinParts(i18n, [
    getFirstPartyKindName(i18n, card.type),
    card.title,
    card.subtitle,
    // The action is text of this app, not of a person: nothing to isolate.
    i18n(
      'icu:TellomiLinkCard__a11y_button_with_action',
      { action: card.action },
      { bidi: 'strip' }
    ),
  ]);
}
