// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import lodash from 'lodash';

import type {
  PinMessageData,
  ReadonlyMessageAttributesType,
} from '../model-types.d.ts';
import { createLogger } from '../logging/log.std.ts';
import { getMessageById } from '../messages/getMessageById.preload.ts';
import { DataReader } from '../sql/Client.preload.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import * as Errors from '../types/errors.std.ts';
import { hydrateRanges } from './BodyRange.node.ts';
import { findAndFormatContact } from './findAndFormatContact.preload.ts';
import { getTellomiPinSubject } from './tellomiPinNotice.std.ts';
import type { TellomiPinSubject } from './tellomiPinNotice.std.ts';

const { chunk, isEqual } = lodash;

const log = createLogger('tellomiPinNoticeRefresh');

// ADR-0081 §4.4: what a pin's chat event says about the pinned message, read from that message as it is now; none
// when it is gone or deleted for everyone ("×× pinned a message").
export async function getTellomiPinSubjectForPin(
  pinMessage: PinMessageData
): Promise<TellomiPinSubject | undefined> {
  const found = await DataReader.getMessageByAuthorAciAndSentAt(
    itemStorage.user.getCheckedAci(),
    pinMessage.targetAuthorAci,
    pinMessage.targetSentTimestamp,
    { includeEdits: true }
  );
  if (found == null) {
    return undefined;
  }
  // The copy in memory can be newer than the one saved.
  const target = window.MessageCache.getById(found.id)?.attributes ?? found;
  return getTellomiPinSubject(
    target,
    hydrateRanges(target.bodyRanges, findAndFormatContact) ?? []
  );
}

// ADR-0081 §4.4: after these messages were edited, deleted for everyone or deleted, redo what the chat events that
// pin them say, so an edit shows and a deleted message's words don't stay behind.
export async function refreshTellomiPinNotices(
  messages: ReadonlyArray<
    Pick<ReadonlyMessageAttributesType, 'conversationId' | 'sent_at' | 'type'>
  >
): Promise<void> {
  const sentAtByConversation = new Map<string, Set<number>>();
  for (const { conversationId, sent_at: sentAt, type } of messages) {
    if (type === 'pinned-message-notification' || sentAt == null) {
      continue;
    }
    const sentAts = sentAtByConversation.get(conversationId) ?? new Set();
    sentAts.add(sentAt);
    sentAtByConversation.set(conversationId, sentAts);
  }

  for (const [conversationId, sentAts] of sentAtByConversation) {
    for (const batch of chunk([...sentAts], 500)) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        const ids = await DataReader.getTellomiPinNoticeIdsByTargetSentAt(
          conversationId,
          batch
        );
        for (const id of ids) {
          // oxlint-disable-next-line no-await-in-loop
          await refreshTellomiPinNotice(id);
        }
      } catch (error) {
        log.error(
          `refreshTellomiPinNotices(${conversationId}):`,
          Errors.toLogFormat(error)
        );
      }
    }
  }
}

async function refreshTellomiPinNotice(id: string): Promise<void> {
  const notice = await getMessageById(id);
  const pinMessage = notice?.get('pinMessage');
  if (notice == null || pinMessage == null) {
    return;
  }

  const subject = await getTellomiPinSubjectForPin(pinMessage);
  if (isEqual(subject, notice.get('tellomiPinSubject'))) {
    return;
  }

  log.info(`refreshing ${id}: ${subject?.kind ?? 'a message'}`);
  notice.set({ tellomiPinSubject: subject });
  await window.MessageCache.saveMessage(notice.attributes);
  window.ConversationController.get(
    notice.get('conversationId')
  )?.debouncedUpdateLastMessage();
}
