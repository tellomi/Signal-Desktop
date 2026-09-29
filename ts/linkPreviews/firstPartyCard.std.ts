// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarColorType } from '../types/Colors.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import {
  artAddStickersRoute,
  groupInvitesRoute,
} from '../util/signalRoutes.std.ts';
import { isPackIdValid } from '../util/Stickers.std.ts';
import type { LinkCardType } from './linkCard.std.ts';

// card-visual §5.2 / §3.10 (2026-09-29): a card for a Tellomi object — avatar or cover, a title,
// a subtitle and one action button at the bottom, the way Telegram shows its own objects. The
// words come from the URL and from what this device already has; of what the sender wrote, only
// a group's or a pack's name, which the preview carries (ADR-0063 §4.8). Nothing is fetched to
// draw it (§5.3): a group that no longer exists says so once it is opened.

export type FirstPartyCardKind =
  | 'user'
  | 'group'
  | 'call'
  | 'sticker'
  | 'official';

// What this device already has for the object, read locally.
export type FirstPartyLocalType = Readonly<{
  // tellomi.user: the chat this device has with that username, once the reader accepted it; its
  // name and avatar replace the ones computed from the URL.
  knownUser?: Readonly<{
    title: string;
    avatarUrl?: string;
    avatarPlaceholderGradient?: Readonly<[string, string]>;
    color?: AvatarColorType;
    hasAvatar?: boolean;
    phoneNumber?: string;
    profileName?: string;
  }>;
  // tellomi.group: this account is a member of the group.
  isGroupMember?: boolean;
  // tellomi.sticker: the pack is installed.
  isStickerPackInstalled?: boolean;
}>;

export type FirstPartyCardDisplayType = Readonly<{
  type: FirstPartyCardKind;
  title: string;
  subtitle: string | undefined;
  // The label of the button at the bottom (card-visual §3.10).
  action: string;
  officialBadge: boolean;
}>;

// A count worth showing: a whole number above zero (card-visual §3.9).
function getCount(value: number | null | undefined): number | undefined {
  return value != null && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export function getFirstPartyCardDisplay(
  card: LinkCardType,
  local: FirstPartyLocalType | undefined,
  i18n: LocalizerType
): FirstPartyCardDisplayType | undefined {
  const firstParty = card.first_party;
  if (card.level !== 'first_party' || !firstParty) {
    return undefined;
  }

  switch (firstParty.type) {
    case 'user': {
      const tellomiUser = i18n('icu:TellomiLinkCard__tellomi_user');
      const name = local?.knownUser?.title ?? firstParty.display ?? undefined;
      return {
        type: 'user',
        title: name ?? tellomiUser,
        subtitle: name ? tellomiUser : undefined,
        action: i18n('icu:TellomiLinkCard__action_message'),
        officialBadge: false,
      };
    }
    case 'group': {
      const memberCount = getCount(firstParty.member_count);
      let subtitle: string | undefined;
      if (local?.isGroupMember) {
        subtitle = i18n('icu:TellomiLinkCard__group_joined');
      } else if (memberCount !== undefined) {
        subtitle = i18n('icu:TellomiLinkCard__member_count', {
          count: memberCount,
        });
      }
      return {
        type: 'group',
        title: firstParty.title,
        subtitle,
        action: local?.isGroupMember
          ? i18n('icu:TellomiLinkCard__action_open')
          : i18n('icu:TellomiLinkCard__action_join_group'),
        officialBadge: false,
      };
    }
    case 'call':
      return {
        type: 'call',
        title: firstParty.title ?? i18n('icu:TellomiLinkCard__call_title'),
        subtitle: undefined,
        action: i18n('icu:TellomiLinkCard__action_join_call'),
        officialBadge: false,
      };
    case 'sticker': {
      const stickerCount = getCount(firstParty.sticker_count);
      let subtitle: string | undefined;
      if (local?.isStickerPackInstalled) {
        subtitle = i18n('icu:TellomiLinkCard__stickers_added');
      } else if (stickerCount !== undefined) {
        subtitle = i18n('icu:TellomiLinkCard__sticker_count', {
          count: stickerCount,
        });
      }
      return {
        type: 'sticker',
        title: firstParty.title,
        subtitle,
        action: local?.isStickerPackInstalled
          ? i18n('icu:TellomiLinkCard__action_view_stickers')
          : i18n('icu:TellomiLinkCard__action_add_stickers'),
        officialBadge: false,
      };
    }
    case 'official':
      return {
        type: 'official',
        title: i18n('icu:TellomiLinkCard__official_title'),
        subtitle: firstParty.path,
        action: i18n('icu:TellomiLinkCard__action_open'),
        officialBadge: card.official_badge,
      };
    default:
      throw missingCaseError(firstParty);
  }
}

// What to look the object up by, from the URL itself (ADR-0063 §4.8: identity comes from the URL,
// not from the sender). Usernames are compared lower-case.
export type FirstPartyLookupKeysType = Readonly<{
  username?: string;
  groupInviteCode?: string;
  stickerPackId?: string;
}>;

export function getFirstPartyLookupKeys(
  url: string,
  card: LinkCardType
): FirstPartyLookupKeysType {
  const firstParty = card.first_party;
  if (card.level !== 'first_party' || !firstParty) {
    return {};
  }

  switch (firstParty.type) {
    case 'user':
      return firstParty.username
        ? { username: firstParty.username.toLowerCase() }
        : {};
    case 'group': {
      const inviteCode = groupInvitesRoute.fromUrl(url)?.args.inviteCode;
      return inviteCode ? { groupInviteCode: inviteCode } : {};
    }
    case 'sticker': {
      const packId = artAddStickersRoute.fromUrl(url)?.args.packId;
      return isPackIdValid(packId) ? { stickerPackId: packId } : {};
    }
    case 'call':
    case 'official':
      return {};
    default:
      throw missingCaseError(firstParty);
  }
}
