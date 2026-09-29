// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalizerType } from '../types/Util.std.ts';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import type { LinkCardType } from './linkCard.std.ts';
import { getLocalizedLinkName } from './linkCard.std.ts';

// What a message bubble shows for a link preview, by the level rust/links decided (ADR-0063
// §5.1 ladder, card-visual §3–§5). Visual details (layout, tint, action buttons) come with the
// finalized card spec; this only keeps each level's text honest:
// - generic: Signal's snapshot, unchanged;
// - brand: the platform name, no image and no sender-written text;
// - structured: the validated title and one line of attrs in place of the description;
// - first party: text computed from the URL (user, official site), never the sender's.
// Whether the image shows is decided once, in the selector (`card.show_image`).
export type LinkPreviewDisplayType = Readonly<{
  title: string | undefined;
  description: string | undefined;
  domain: string | undefined;
  officialBadge: boolean;
}>;

type PreviewForDisplay = Readonly<{
  title?: string;
  description?: string;
  domain?: string;
  card?: LinkCardType;
}>;

export function formatDurationMs(
  value: string | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    return undefined;
  }
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
    : `${minutes}:${ss}`;
}

// A publish date: medium length, no time, no year when it is this year (card-visual §3.9).
export function formatLinkCardDate(
  timestamp: number,
  locale: string,
  now: number = Date.now()
): string {
  const sameYear =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

// Attrs shown as plain text, in this order (kinds.toml). Counts, dates and coordinates wait for
// the finalized card spec (they need localized formatting).
const TEXT_ATTRS = [
  'author',
  'artist',
  'album',
  'developer',
  'owner',
  'name',
  'address',
  'platform',
];

export function formatLinkCardAttrs(card: LinkCardType): string | undefined {
  const byKey = new Map(card.attrs.map(({ key, value }) => [key, value]));
  const parts: Array<string> = [];
  for (const key of TEXT_ATTRS) {
    const value = byKey.get(key);
    if (value) {
      parts.push(value);
    }
  }
  const duration = byKey.get('duration_ms');
  const formatted = duration ? formatDurationMs(duration) : undefined;
  if (formatted) {
    parts.push(formatted);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function getLinkPreviewDisplay(
  preview: PreviewForDisplay,
  i18n: LocalizerType,
  _now: number = Date.now()
): LinkPreviewDisplayType {
  const { card } = preview;
  const snapshot: LinkPreviewDisplayType = {
    title: preview.title,
    description: preview.description,
    domain: card?.domain ?? preview.domain,
    officialBadge: false,
  };
  if (!card) {
    return { ...snapshot, domain: preview.domain };
  }

  switch (card.level) {
    case 'plain_link':
    case 'generic':
      return snapshot;
    case 'brand':
      return {
        title: card.provider_name
          ? getLocalizedLinkName(card.provider_name, i18n.getLocale())
          : undefined,
        description: undefined,
        domain: snapshot.domain,
        officialBadge: false,
      };
    case 'structured':
      return {
        title: card.title ?? preview.title,
        description: formatLinkCardAttrs(card),
        domain: snapshot.domain,
        officialBadge: false,
      };
    case 'first_party': {
      const firstParty = card.first_party;
      switch (firstParty?.type) {
        case 'official':
          return {
            title: i18n('icu:TellomiLinkCard__official_title'),
            description: firstParty.path,
            domain: snapshot.domain,
            officialBadge: card.official_badge,
          };
        case 'user': {
          const user = i18n('icu:TellomiLinkCard__tellomi_user');
          return {
            title: firstParty.display ?? user,
            description: firstParty.display ? user : undefined,
            domain: snapshot.domain,
            officialBadge: false,
          };
        }
        case 'group':
        case 'sticker':
          return {
            ...snapshot,
            title: firstParty.title,
          };
        case 'call':
          return {
            ...snapshot,
            title: firstParty.title ?? preview.title,
          };
        default:
          return snapshot;
      }
    }
    default:
      throw missingCaseError(card.level);
  }
}
