// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { LRUCache } from 'lru-cache';

import * as Bytes from '../Bytes.std.ts';
import { SignalService as Proto } from '../protobuf/index.std.ts';
import type { ConversationType } from '../state/ducks/conversations.preload.ts';
import type { AciString } from '../types/ServiceId.std.ts';
import { fromWebSafeBase64 } from '../util/webSafeBase64.std.ts';
import {
  deriveGroupID,
  deriveGroupSecretParams,
} from '../util/zkgroup.node.ts';
import type { LinkCardType } from './linkCard.std.ts';
import type { FirstPartyLocalType } from './firstPartyCard.std.ts';
import { getFirstPartyLookupKeys } from './firstPartyCard.std.ts';

// ADR-0063 §4.8 / card-visual §5.2: what a first-party card needs from this device's own data —
// the chat with a username, whether the account is in a group, whether a sticker pack is
// installed. Read locally only, never fetched. The selector passes the reads in, so a timeline
// item only watches the entries it actually looked at.
export type LinkLocalLookupType = Readonly<{
  ourAci: AciString | undefined;
  getConversationByUsername: (username: string) => ConversationType | undefined;
  getConversationByGroupId: (groupId: string) => ConversationType | undefined;
  isStickerPackInstalled: (packId: string) => boolean;
}>;

// Invite code → base64 group id ('' when the code does not decode). Deriving the id is a
// zkgroup computation, so it is done once per link.
const groupIdCache = new LRUCache<string, string>({ max: 500 });

function getGroupIdFromInviteCode(inviteCode: string): string | undefined {
  const cached = groupIdCache.get(inviteCode);
  if (cached !== undefined) {
    return cached || undefined;
  }

  let groupId = '';
  try {
    const link = Proto.GroupInviteLink.decode(
      Bytes.fromBase64(fromWebSafeBase64(inviteCode))
    );
    const masterKey = link.contents?.contentsV1?.groupMasterKey;
    if (masterKey?.length) {
      groupId = Bytes.toBase64(
        deriveGroupID(
          deriveGroupSecretParams(Bytes.fromBase64(Bytes.toBase64(masterKey)))
        )
      );
    }
  } catch {
    // Not a group invite this build can read: nothing to look up.
    groupId = '';
  }
  groupIdCache.set(inviteCode, groupId);
  return groupId || undefined;
}

export function getFirstPartyLocal(
  url: string,
  card: LinkCardType,
  lookup: LinkLocalLookupType
): FirstPartyLocalType | undefined {
  const { username, groupInviteCode, stickerPackId } = getFirstPartyLookupKeys(
    url,
    card
  );

  if (username !== undefined) {
    const conversation = lookup.getConversationByUsername(username);
    // A chat the reader has not accepted keeps its name and avatar to itself, as elsewhere.
    if (
      !conversation ||
      !(conversation.acceptedMessageRequest || conversation.isMe)
    ) {
      return undefined;
    }
    return {
      knownUser: {
        title: conversation.title,
        avatarUrl: conversation.avatarUrl,
        avatarPlaceholderGradient: conversation.avatarPlaceholderGradient,
        color: conversation.color,
        hasAvatar: conversation.hasAvatar,
        phoneNumber: conversation.phoneNumber,
        profileName: conversation.profileName,
      },
    };
  }

  if (groupInviteCode !== undefined) {
    const groupId = getGroupIdFromInviteCode(groupInviteCode);
    const group =
      groupId === undefined
        ? undefined
        : lookup.getConversationByGroupId(groupId);
    const { ourAci } = lookup;
    const isGroupMember = Boolean(
      ourAci && group?.memberships?.some(({ aci }) => aci === ourAci)
    );
    return isGroupMember ? { isGroupMember } : undefined;
  }

  if (stickerPackId !== undefined) {
    return lookup.isStickerPackInstalled(stickerPackId)
      ? { isStickerPackInstalled: true }
      : undefined;
  }

  return undefined;
}
