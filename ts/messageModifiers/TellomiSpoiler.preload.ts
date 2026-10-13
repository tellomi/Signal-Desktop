// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { AttachmentType } from '../types/Attachment.std.ts';
import { doAttachmentsOnSameMessageMatch } from '../util/Attachment.std.ts';
import { getMessageById } from '../messages/getMessageById.preload.ts';
import { createLogger } from '../logging/log.std.ts';

const log = createLogger('TellomiSpoiler');

/**
 * Tellomi (tellomi/tellomi#1263, spec R-1, D10): [attachment] on [messageId] was uncovered on this
 * device, so it stays uncovered here (the edit history's copies too). Local only: never sent, never
 * backed up.
 */
export async function revealTellomiSpoiler(
  messageId: string,
  attachment: Pick<AttachmentType, 'digest' | 'plaintextHash' | 'path'>
): Promise<void> {
  const message = await getMessageById(messageId);
  if (!message) {
    return;
  }

  let changed = false;
  const reveal = (
    attachments: ReadonlyArray<AttachmentType> | undefined
  ): Array<AttachmentType> | undefined =>
    attachments?.map(existing => {
      if (
        existing.tellomiSpoiler !== true ||
        existing.tellomiSpoilerRevealed === true ||
        !isSameAttachment(existing, attachment)
      ) {
        return existing;
      }
      changed = true;
      return { ...existing, tellomiSpoilerRevealed: true };
    });

  const attachments = reveal(message.get('attachments'));
  const editHistory = message
    .get('editHistory')
    ?.map(edit =>
      edit.attachments
        ? { ...edit, attachments: reveal(edit.attachments) }
        : edit
    );

  if (!changed) {
    return;
  }

  log.info(`revealTellomiSpoiler: ${messageId}`);
  message.set({
    attachments,
    ...(editHistory ? { editHistory } : {}),
  });
  await window.MessageCache.saveMessage(message.attributes);
}

function isSameAttachment(
  a: Pick<AttachmentType, 'digest' | 'plaintextHash' | 'path'>,
  b: Pick<AttachmentType, 'digest' | 'plaintextHash' | 'path'>
): boolean {
  if (a.path && b.path) {
    return a.path === b.path;
  }
  return doAttachmentsOnSameMessageMatch(
    a as AttachmentType,
    b as AttachmentType
  );
}
