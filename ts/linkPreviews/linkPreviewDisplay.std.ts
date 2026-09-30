// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalizerType } from '../types/Util.std.ts';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import type { LinkCardType } from './linkCard.std.ts';
import { getLocalizedLinkName } from './linkCard.std.ts';

// What a message bubble shows for a link preview, by the level rust/links decided (ADR-0063
// §5.1 ladder), per the finalized card spec (card-visual §3.7 / §3.9 / §3.10, 2026-09-29): a
// title, one sub line and the domain line. The sender's description never shows.
// - plain link: only as the no-image card of a message that is just the link, titled by the
//   registrable domain (§3.5);
// - generic: the snapshot title and the registrable domain;
// - brand: the platform name and what the link is (the kind's name); no image, no sender text;
// - structured: the validated title and the kind's sub line; a video's publish date follows the
//   domain;
// - first party: text computed from the URL (user, official site), never the sender's.
// Layout, tint and action buttons are not decided here. Whether the image shows is decided once,
// in the selector (`card.show_image`).
export type LinkPreviewDisplayType = Readonly<{
  title: string | undefined;
  description: string | undefined;
  domain: string | undefined;
  officialBadge: boolean;
  // A card decided the domain line, so the snapshot's own date is not shown (card-visual §3.4).
  hideSnapshotDate: boolean;
}>;

type PreviewForDisplay = Readonly<{
  title?: string;
  description?: string;
  domain?: string;
  card?: LinkCardType;
}>;

// card-visual §3.7: the parts of the sub line are joined by U+00B7; the domain and the publish
// date of a video, on the domain line, by U+22C5 (a different dot, on purpose).
const SEPARATOR = ' \u00B7 ';
const DOMAIN_DATE_SEPARATOR = ' \u22C5 ';

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  ios: 'iOS',
  android: 'Android',
};

// card-visual §3.10: every kind in links/kinds.toml, reserved ones included (they only ever show
// on brand shells).
function getKindName(kind: string, i18n: LocalizerType): string | undefined {
  switch (kind) {
    case 'video':
      return i18n('icu:TellomiLinkCard__kind_video');
    case 'channel':
      return i18n('icu:TellomiLinkCard__kind_channel');
    case 'music.track':
      return i18n('icu:TellomiLinkCard__kind_music_track');
    case 'music.album':
      return i18n('icu:TellomiLinkCard__kind_music_album');
    case 'music.playlist':
      return i18n('icu:TellomiLinkCard__kind_music_playlist');
    case 'place':
      return i18n('icu:TellomiLinkCard__kind_place');
    case 'app':
      return i18n('icu:TellomiLinkCard__kind_app');
    case 'repo':
      return i18n('icu:TellomiLinkCard__kind_repo');
    case 'article':
      return i18n('icu:TellomiLinkCard__kind_article');
    case 'product':
      return i18n('icu:TellomiLinkCard__kind_product');
    case 'package':
      return i18n('icu:TellomiLinkCard__kind_package');
    case 'question':
      return i18n('icu:TellomiLinkCard__kind_question');
    case 'deal':
      return i18n('icu:TellomiLinkCard__kind_deal');
    case 'ride':
      return i18n('icu:TellomiLinkCard__kind_ride');
    case 'payment':
      return i18n('icu:TellomiLinkCard__kind_payment');
    case 'web':
      return i18n('icu:TellomiLinkCard__kind_web');
    default:
      return undefined;
  }
}

// `m:ss` under an hour, `h:mm:ss` from an hour; zero, negative or not a number shows nothing
// (card-visual §3.9), and neither does a duration that rounds to zero seconds (1 to 499 ms):
// `0:00` would say the video has no length.
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
  if (totalSeconds <= 0) {
    return undefined;
  }
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

function parseDate(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function joinParts(
  ...parts: ReadonlyArray<string | undefined>
): string | undefined {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(SEPARATOR) : undefined;
}

function getStructuredDisplay(
  preview: PreviewForDisplay,
  card: LinkCardType,
  i18n: LocalizerType,
  now: number
): LinkPreviewDisplayType {
  const attrs = new Map(card.attrs.map(({ key, value }) => [key, value]));
  const text = (key: string): string | undefined => attrs.get(key) || undefined;
  const trackCount = (): string | undefined => {
    const count = Number(attrs.get('track_count'));
    return Number.isSafeInteger(count) && count > 0
      ? i18n('icu:TellomiLinkCard__track_count', { count })
      : undefined;
  };
  const title = card.title || preview.title || undefined;
  const domain = card.domain ?? preview.domain;
  const withLine = (
    description: string | undefined
  ): LinkPreviewDisplayType => ({
    title,
    description,
    domain,
    officialBadge: false,
    hideSnapshotDate: true,
  });

  switch (card.kind) {
    case 'video': {
      const published = parseDate(text('published_at'));
      return {
        ...withLine(
          joinParts(text('author'), formatDurationMs(text('duration_ms')))
        ),
        domain:
          domain && published !== undefined
            ? `${domain}${DOMAIN_DATE_SEPARATOR}${formatLinkCardDate(published, i18n.getLocale(), now)}`
            : domain,
      };
    }
    case 'channel':
      return withLine(joinParts(text('author')));
    case 'music.track':
      return withLine(
        joinParts(
          text('artist'),
          text('album'),
          formatDurationMs(text('duration_ms'))
        )
      );
    case 'music.album':
      return withLine(joinParts(text('artist'), trackCount()));
    case 'music.playlist':
      return withLine(joinParts(text('author'), trackCount()));
    case 'app': {
      const platform = text('platform');
      return withLine(
        joinParts(
          text('developer'),
          platform ? PLATFORM_NAMES[platform] : undefined
        )
      );
    }
    case 'repo':
      return withLine(joinParts(text('owner')));
    case 'place':
      return {
        ...withLine(joinParts(text('address'))),
        title: text('name') || title || i18n('icu:TellomiLinkCard__place'),
      };
    default:
      // A kind this build does not know: show it like generic.
      return withLine(undefined);
  }
}

export function getLinkPreviewDisplay(
  preview: PreviewForDisplay,
  i18n: LocalizerType,
  now: number = Date.now()
): LinkPreviewDisplayType {
  const { card } = preview;
  const snapshot: LinkPreviewDisplayType = {
    title: preview.title,
    description: preview.description,
    domain: card?.domain ?? preview.domain,
    officialBadge: false,
    hideSnapshotDate: false,
  };
  if (!card) {
    return { ...snapshot, domain: preview.domain };
  }

  switch (card.level) {
    case 'plain_link':
      // Only reaches a bubble as the no-image card of a message that is just this link
      // (card-visual §3.5): the domain in the title slot, written once.
      return {
        title: snapshot.domain,
        description: undefined,
        domain: undefined,
        officialBadge: false,
        hideSnapshotDate: true,
      };
    case 'generic':
      return {
        title: card.title || preview.title || undefined,
        description: undefined,
        domain: snapshot.domain,
        officialBadge: false,
        hideSnapshotDate: true,
      };
    case 'brand':
      return {
        title: card.provider_name
          ? getLocalizedLinkName(card.provider_name, i18n.getLocale())
          : undefined,
        description: card.kind ? getKindName(card.kind, i18n) : undefined,
        domain: snapshot.domain,
        officialBadge: false,
        hideSnapshotDate: true,
      };
    case 'structured':
      return getStructuredDisplay(preview, card, i18n, now);
    case 'first_party': {
      const firstParty = card.first_party;
      switch (firstParty?.type) {
        case 'official':
          return {
            title: i18n('icu:TellomiLinkCard__official_title'),
            description: firstParty.path,
            domain: snapshot.domain,
            officialBadge: card.official_badge,
            hideSnapshotDate: true,
          };
        case 'user': {
          const user = i18n('icu:TellomiLinkCard__tellomi_user');
          return {
            title: firstParty.display ?? user,
            description: firstParty.display ? user : undefined,
            domain: snapshot.domain,
            officialBadge: false,
            hideSnapshotDate: true,
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
