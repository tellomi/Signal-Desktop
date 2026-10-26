// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import { DataReader } from '../sql/Client.preload.ts';
import * as Errors from '../types/errors.std.ts';
import type { AttachmentType } from '../types/Attachment.std.ts';
import { getLocalAttachmentUrl } from './getLocalAttachmentUrl.std.ts';
import {
  chooseCalendarDayThumbnail,
  firstGalleryMediaPerLocalDay,
  isVideoContentType,
  type TellomiCalendarDayThumbnail,
} from './tellomiConversationDayThumbnails.std.ts';

const log = createLogger('tellomiCalendarDayThumbnails');

function urlForPath(
  attachment: Parameters<typeof getLocalAttachmentUrl>[0] | undefined
): string | undefined {
  if (attachment?.path == null) {
    return undefined;
  }
  return getLocalAttachmentUrl(attachment);
}

function thumbnailForAttachment(
  dayStartMs: number,
  attachment: AttachmentType
): TellomiCalendarDayThumbnail | undefined {
  const isVideo = isVideoContentType(attachment.contentType);
  return chooseCalendarDayThumbnail(dayStartMs, {
    tellomiSpoiler: attachment.tellomiSpoiler,
    tellomiSpoilerRevealed: attachment.tellomiSpoilerRevealed,
    blurHash: attachment.blurHash,
    thumbnailUrl: urlForPath(attachment.thumbnail),
    screenshotUrl: urlForPath(
      attachment.screenshot?.path != null
        ? { ...attachment.screenshot, size: attachment.screenshot.size ?? 0 }
        : undefined
    ),
    imageUrl: isVideo ? undefined : urlForPath(attachment),
    backupThumbnailUrl: urlForPath(
      attachment.thumbnailFromBackup?.path != null
        ? {
            ...attachment.thumbnailFromBackup,
            size: attachment.thumbnailFromBackup.size ?? 0,
          }
        : undefined
    ),
    isVideo,
  });
}

/**
 * First gallery thumbnail for each selectable day in `[startMs, endMs)`.
 * Call once per visible month. `daysWithMessages` is the send-time set the
 * calendar already uses to grey empty days.
 */
export async function loadTellomiCalendarDayThumbnails({
  conversationId,
  startMs,
  endMs,
  daysWithMessages,
}: {
  conversationId: string;
  startMs: number;
  endMs: number;
  daysWithMessages: ReadonlySet<number>;
}): Promise<ReadonlyArray<TellomiCalendarDayThumbnail>> {
  const rows = await DataReader.getTellomiCalendarGalleryMedia(conversationId, {
    startMs,
    endMs,
  });
  const picked = firstGalleryMediaPerLocalDay(
    rows.map(row => ({
      bucketMs: row.bucketMs,
      sentAt: row.sentAt,
      orderInMessage: row.orderInMessage,
      attachmentType: row.attachmentType,
      contentType: row.attachment.contentType,
      flags: row.attachment.flags,
      tellomiAsFile: row.attachment.tellomiAsFile,
      isViewOnce: row.isViewOnce,
      value: row,
    })),
    { daysWithMessages }
  );

  const result: Array<TellomiCalendarDayThumbnail> = [];
  for (const [dayStartMs, row] of picked) {
    try {
      const thumb = thumbnailForAttachment(dayStartMs, row.attachment);
      if (thumb != null) {
        result.push(thumb);
      }
    } catch (error) {
      log.warn('skipping jump-to-date thumbnail', Errors.toLogFormat(error));
    }
  }
  return result;
}
