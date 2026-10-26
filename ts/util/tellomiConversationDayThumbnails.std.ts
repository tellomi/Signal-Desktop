// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { startOfLocalDayMs } from './tellomiJumpToDate.std.ts';

/**
 * Tellomi (desktop audit 7.2 / F03b): jump-to-date day-cell thumbnails.
 *
 * Gallery membership matches Desktop "all media" (`getSortedMedia` type
 * `media`): current message only, real attachments (not quotes, stickers,
 * link-preview images, or contacts), not view-once, not sent-as-file, image
 * or video. `flags === VOICE_MESSAGE` is excluded with the same equality
 * check as that query (`flags IS NOT 1`), not a bitmask test.
 *
 * A day's thumbnail is the earliest gallery item whose receipt time falls on
 * that local day (`receivedAtMs`, or `sentAt` when receipt time is missing).
 * Selectable days stay keyed by send time. A send/receipt midnight split can
 * put the thumbnail on the other cell; it does not change which day jump
 * uses. Same rule as Android `TellomiConversationDayThumbnails`.
 */

/**
 * SignalService.AttachmentPointer.Flags.VOICE_MESSAGE.
 * Kept as a literal so this module does not import generated protobuf code.
 */
export const TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG = 1;

export type TellomiCalendarDayThumbnail = Readonly<{
  /** Local midnight of the receipt day the thumbnail belongs to. */
  dayStartMs: number;
  /** Decryptable image URL. Omitted when the file is not on disk or the image is spoiler-covered. */
  url?: string;
  blurHash?: string;
}>;

export type TellomiGalleryMediaCandidate<T> = Readonly<{
  /** Receipt time used to place the thumbnail. See `galleryBucketMs`. */
  bucketMs: number;
  sentAt: number;
  orderInMessage: number;
  attachmentType: string;
  contentType?: string | null;
  flags?: number | null;
  tellomiAsFile?: boolean | null;
  isViewOnce?: boolean | null;
  value: T;
}>;

/** Receipt instant for calendar bucketing. Missing or zero receipt time uses `sentAt`. */
export function galleryBucketMs(input: {
  receivedAtMs?: number | null;
  sentAt: number;
}): number {
  const received = input.receivedAtMs;
  if (received != null && received > 0) {
    return received;
  }
  return input.sentAt;
}

/**
 * True when this attachment would appear in the conversation media gallery.
 * Keep in sync with `getTellomiCalendarGalleryMedia` in `ts/sql/Server.node.ts`.
 */
export function isAllMediaGalleryAttachment(
  candidate: Pick<
    TellomiGalleryMediaCandidate<unknown>,
    'attachmentType' | 'contentType' | 'flags' | 'tellomiAsFile' | 'isViewOnce'
  >
): boolean {
  if (candidate.attachmentType !== 'attachment') {
    return false;
  }
  if (candidate.tellomiAsFile === true) {
    return false;
  }
  if (candidate.isViewOnce === true) {
    return false;
  }
  if (candidate.flags === TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG) {
    return false;
  }
  const contentType = candidate.contentType ?? '';
  return contentType.startsWith('image/') || contentType.startsWith('video/');
}

export function isVideoContentType(
  contentType: string | null | undefined
): boolean {
  return (contentType ?? '').startsWith('video/');
}

/**
 * Local `[start, end)` of a calendar month. `month` is 1–12.
 * Bounds are local midnights, so a DST month is not a fixed number of hours.
 */
export function localMonthIntervalMs(
  year: number,
  month: number
): { startMs: number; endMs: number } {
  return {
    startMs: new Date(year, month - 1, 1).getTime(),
    endMs: new Date(year, month, 1).getTime(),
  };
}

/**
 * Month interval plus the week fragments the month grid shows from the
 * previous and next month. Uses calendar-day arithmetic, not 24h steps.
 */
export function calendarFetchIntervalMs(
  year: number,
  month: number
): { startMs: number; endMs: number } {
  const { startMs, endMs } = localMonthIntervalMs(year, month);
  const start = new Date(startMs);
  const end = new Date(endMs);
  return {
    startMs: new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() - 7
    ).getTime(),
    endMs: new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate() + 7
    ).getTime(),
  };
}

function compareGalleryMedia(
  a: TellomiGalleryMediaCandidate<unknown>,
  b: TellomiGalleryMediaCandidate<unknown>
): number {
  if (a.bucketMs !== b.bucketMs) {
    return a.bucketMs - b.bucketMs;
  }
  if (a.sentAt !== b.sentAt) {
    return a.sentAt - b.sentAt;
  }
  return a.orderInMessage - b.orderInMessage;
}

/**
 * First gallery attachment on each local receipt day.
 * `daysWithMessages` (local midnights of send time) drops days that are not
 * selectable. Omit it to keep every day that has gallery media.
 */
export function firstGalleryMediaPerLocalDay<T>(
  items: ReadonlyArray<TellomiGalleryMediaCandidate<T>>,
  options?: { daysWithMessages?: ReadonlySet<number> }
): Map<number, T> {
  const days = options?.daysWithMessages;
  const sorted = items.slice().sort(compareGalleryMedia);
  const result = new Map<number, T>();
  for (const item of sorted) {
    if (!Number.isFinite(item.bucketMs) || !isAllMediaGalleryAttachment(item)) {
      continue;
    }
    const dayStartMs = startOfLocalDayMs(item.bucketMs);
    if (days != null && !days.has(dayStartMs)) {
      continue;
    }
    if (!result.has(dayStartMs)) {
      result.set(dayStartMs, item.value);
    }
  }
  return result;
}

/**
 * Same rule as `isTellomiSpoilerCovered`: a covered image must not be shown
 * clear in the calendar.
 */
export function canShowClearCalendarThumbnail(attachment: {
  tellomiSpoiler?: boolean | null;
  tellomiSpoilerRevealed?: boolean | null;
}): boolean {
  return !(
    attachment.tellomiSpoiler === true &&
    attachment.tellomiSpoilerRevealed !== true
  );
}

export type TellomiCalendarThumbSource = Readonly<{
  tellomiSpoiler?: boolean | null;
  tellomiSpoilerRevealed?: boolean | null;
  blurHash?: string | null;
  thumbnailUrl?: string | null;
  screenshotUrl?: string | null;
  imageUrl?: string | null;
  backupThumbnailUrl?: string | null;
  isVideo: boolean;
}>;

/**
 * Which pixels to paint in the day cell.
 * Preference matches `getThumbnailUrl` / `getUrl`: thumbnail, then screenshot,
 * then the image file (never the video file), then the backup thumbnail.
 * A spoiler-covered item contributes only its blurHash.
 */
export function chooseCalendarDayThumbnail(
  dayStartMs: number,
  source: TellomiCalendarThumbSource
): TellomiCalendarDayThumbnail | undefined {
  const blurHash =
    source.blurHash != null && source.blurHash !== ''
      ? source.blurHash
      : undefined;
  if (!canShowClearCalendarThumbnail(source)) {
    return blurHash != null ? { dayStartMs, blurHash } : undefined;
  }
  const url =
    nonempty(source.thumbnailUrl) ??
    nonempty(source.screenshotUrl) ??
    (source.isVideo ? undefined : nonempty(source.imageUrl)) ??
    nonempty(source.backupThumbnailUrl);
  if (url == null && blurHash == null) {
    return undefined;
  }
  if (url != null && blurHash != null) {
    return { dayStartMs, url, blurHash };
  }
  if (url != null) {
    return { dayStartMs, url };
  }
  return { dayStartMs, blurHash };
}

function nonempty(value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  return value;
}
