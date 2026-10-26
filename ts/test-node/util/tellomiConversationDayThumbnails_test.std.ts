// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG,
  calendarFetchIntervalMs,
  canShowClearCalendarThumbnail,
  chooseCalendarDayThumbnail,
  firstGalleryMediaPerLocalDay,
  galleryBucketMs,
  isAllMediaGalleryAttachment,
  localMonthIntervalMs,
  type TellomiGalleryMediaCandidate,
} from '../../util/tellomiConversationDayThumbnails.std.ts';
import {
  buildDaysWithMessagesSet,
  startOfLocalDayMs,
} from '../../util/tellomiJumpToDate.std.ts';

type Item = { id: string };

function candidate(
  overrides: Partial<TellomiGalleryMediaCandidate<Item>> & { id?: string }
): TellomiGalleryMediaCandidate<Item> {
  const id = overrides.id ?? overrides.value?.id ?? 'media';
  return {
    bucketMs: overrides.bucketMs ?? 0,
    sentAt: overrides.sentAt ?? overrides.bucketMs ?? 0,
    orderInMessage: overrides.orderInMessage ?? 0,
    attachmentType: overrides.attachmentType ?? 'attachment',
    contentType: overrides.contentType ?? 'image/jpeg',
    flags: overrides.flags === undefined ? 0 : overrides.flags,
    tellomiAsFile: overrides.tellomiAsFile ?? false,
    isViewOnce: overrides.isViewOnce ?? false,
    value: overrides.value ?? { id },
  };
}

describe('tellomiConversationDayThumbnails', () => {
  const morning = new Date(2026, 9, 26, 9, 0, 0).getTime();
  const afternoon = new Date(2026, 9, 26, 15, 30, 0).getTime();
  const nextDay = new Date(2026, 9, 27, 1, 0, 0).getTime();

  it('galleryBucketMs prefers a real receipt time and falls back to sentAt', () => {
    assert.strictEqual(
      galleryBucketMs({ receivedAtMs: afternoon, sentAt: morning }),
      afternoon
    );
    assert.strictEqual(
      galleryBucketMs({ receivedAtMs: null, sentAt: morning }),
      morning
    );
    assert.strictEqual(
      galleryBucketMs({ receivedAtMs: 0, sentAt: morning }),
      morning
    );
    assert.strictEqual(galleryBucketMs({ sentAt: morning }), morning);
  });

  it('isAllMediaGalleryAttachment matches the all-media gallery filter', () => {
    assert.isTrue(isAllMediaGalleryAttachment(candidate({})));
    assert.isTrue(
      isAllMediaGalleryAttachment(
        candidate({ contentType: 'video/mp4', id: 'video' })
      )
    );
    // Desktop gallery uses image/%, including svg. Android's gallery query drops svg.
    assert.isTrue(
      isAllMediaGalleryAttachment(
        candidate({ contentType: 'image/svg+xml', id: 'svg' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ contentType: 'application/pdf', id: 'file' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ contentType: 'audio/aac', id: 'audio' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(candidate({ contentType: '', id: 'empty' }))
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ tellomiAsFile: true, id: 'as-file' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ isViewOnce: true, id: 'view-once' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ attachmentType: 'quote', id: 'quote' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ attachmentType: 'sticker', id: 'sticker' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({ attachmentType: 'preview', id: 'preview' })
      )
    );
    assert.isFalse(
      isAllMediaGalleryAttachment(
        candidate({
          flags: TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG,
          id: 'voice-flag',
        })
      )
    );
    // Equality, not a bitmask: flags 3 (not exactly VOICE_MESSAGE) still counts.
    assert.isTrue(
      isAllMediaGalleryAttachment(candidate({ flags: 3, id: 'other-flags' }))
    );
    assert.isTrue(
      isAllMediaGalleryAttachment(candidate({ flags: null, id: 'null-flags' }))
    );
  });

  it('firstGalleryMediaPerLocalDay keeps the earliest gallery item each day', () => {
    const picked = firstGalleryMediaPerLocalDay([
      candidate({ id: 'later', bucketMs: afternoon, sentAt: afternoon }),
      candidate({
        id: 'earlier',
        bucketMs: morning,
        sentAt: morning,
        orderInMessage: 1,
      }),
      candidate({ id: 'next', bucketMs: nextDay, sentAt: nextDay }),
      candidate({
        id: 'file',
        bucketMs: morning - 1000,
        contentType: 'application/pdf',
      }),
    ]);

    assert.strictEqual(picked.size, 2);
    assert.strictEqual(picked.get(startOfLocalDayMs(morning))?.id, 'earlier');
    assert.strictEqual(picked.get(startOfLocalDayMs(nextDay))?.id, 'next');
  });

  it('breaks ties by sentAt then orderInMessage', () => {
    const picked = firstGalleryMediaPerLocalDay([
      candidate({
        id: 'second-in-album',
        bucketMs: afternoon,
        sentAt: afternoon,
        orderInMessage: 2,
      }),
      candidate({
        id: 'later-send',
        bucketMs: afternoon,
        sentAt: afternoon + 5,
        orderInMessage: 0,
      }),
      candidate({
        id: 'first-in-album',
        bucketMs: afternoon,
        sentAt: afternoon,
        orderInMessage: 0,
      }),
    ]);
    assert.strictEqual(
      picked.get(startOfLocalDayMs(afternoon))?.id,
      'first-in-album'
    );
  });

  it('does not let a later array entry replace the first of the day', () => {
    const picked = firstGalleryMediaPerLocalDay([
      candidate({ id: 'second', bucketMs: afternoon }),
      candidate({ id: 'first', bucketMs: morning }),
    ]);
    assert.strictEqual(picked.get(startOfLocalDayMs(morning))?.id, 'first');
  });

  it('drops days that are not selectable', () => {
    const days = buildDaysWithMessagesSet([morning]);
    const picked = firstGalleryMediaPerLocalDay(
      [
        candidate({ id: 'selectable', bucketMs: morning }),
        candidate({ id: 'empty-day', bucketMs: nextDay }),
      ],
      { daysWithMessages: days }
    );
    assert.strictEqual(picked.size, 1);
    assert.strictEqual(
      picked.get(startOfLocalDayMs(morning))?.id,
      'selectable'
    );
    assert.isFalse(picked.has(startOfLocalDayMs(nextDay)));
  });

  it('places a thumbnail on the receipt day, not the send day', () => {
    // Sent Oct 26, received Oct 27. Selectable send-day does not get this thumb.
    const days = buildDaysWithMessagesSet([morning]);
    const picked = firstGalleryMediaPerLocalDay(
      [
        candidate({
          id: 'crossed-midnight',
          bucketMs: nextDay,
          sentAt: morning,
        }),
      ],
      { daysWithMessages: days }
    );
    assert.strictEqual(picked.size, 0);
  });

  it('localMonthIntervalMs is local midnight to the next month', () => {
    const october = localMonthIntervalMs(2026, 10);
    const start = new Date(october.startMs);
    const end = new Date(october.endMs);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 9);
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(start.getHours(), 0);
    assert.strictEqual(end.getMonth(), 10);
    assert.strictEqual(end.getDate(), 1);
    assert.strictEqual(end.getHours(), 0);
    assert.isAbove(october.endMs, october.startMs);

    const february = localMonthIntervalMs(2026, 2);
    assert.strictEqual(new Date(february.startMs).getDate(), 1);
    assert.strictEqual(new Date(february.endMs).getMonth(), 2);
    assert.strictEqual(new Date(february.endMs).getDate(), 1);
  });

  it('calendarFetchIntervalMs includes the grid padding week on each side', () => {
    const range = calendarFetchIntervalMs(2026, 10);
    const start = new Date(range.startMs);
    const end = new Date(range.endMs);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 8);
    assert.strictEqual(start.getDate(), 24);
    assert.strictEqual(start.getHours(), 0);
    assert.strictEqual(end.getMonth(), 10);
    assert.strictEqual(end.getDate(), 8);
    assert.strictEqual(end.getHours(), 0);
  });

  it('canShowClearCalendarThumbnail hides a covered spoiler until it is revealed', () => {
    assert.isTrue(canShowClearCalendarThumbnail({}));
    assert.isTrue(canShowClearCalendarThumbnail({ tellomiSpoiler: false }));
    assert.isFalse(canShowClearCalendarThumbnail({ tellomiSpoiler: true }));
    assert.isFalse(
      canShowClearCalendarThumbnail({
        tellomiSpoiler: true,
        tellomiSpoilerRevealed: false,
      })
    );
    assert.isTrue(
      canShowClearCalendarThumbnail({
        tellomiSpoiler: true,
        tellomiSpoilerRevealed: true,
      })
    );
  });

  it('chooseCalendarDayThumbnail prefers thumbnail, then screenshot, then image file', () => {
    const day = startOfLocalDayMs(morning);
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: false,
        thumbnailUrl: 'thumb',
        screenshotUrl: 'shot',
        imageUrl: 'full',
        backupThumbnailUrl: 'backup',
      }),
      { dayStartMs: day, url: 'thumb' }
    );
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: true,
        screenshotUrl: 'shot',
        imageUrl: 'full',
      }),
      { dayStartMs: day, url: 'shot' }
    );
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: true,
        imageUrl: 'full',
        backupThumbnailUrl: 'backup',
      }),
      { dayStartMs: day, url: 'backup' }
    );
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: false,
        imageUrl: 'full',
        blurHash: 'hash',
      }),
      { dayStartMs: day, url: 'full', blurHash: 'hash' }
    );
    assert.isUndefined(
      chooseCalendarDayThumbnail(day, { isVideo: true, imageUrl: 'full' })
    );
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, { isVideo: false, blurHash: 'hash' }),
      { dayStartMs: day, blurHash: 'hash' }
    );
  });

  it('chooseCalendarDayThumbnail does not reveal a covered spoiler', () => {
    const day = startOfLocalDayMs(morning);
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: false,
        tellomiSpoiler: true,
        thumbnailUrl: 'thumb',
        imageUrl: 'full',
        blurHash: 'hash',
      }),
      { dayStartMs: day, blurHash: 'hash' }
    );
    assert.isUndefined(
      chooseCalendarDayThumbnail(day, {
        isVideo: false,
        tellomiSpoiler: true,
        thumbnailUrl: 'thumb',
      })
    );
    assert.deepEqual(
      chooseCalendarDayThumbnail(day, {
        isVideo: false,
        tellomiSpoiler: true,
        tellomiSpoilerRevealed: true,
        thumbnailUrl: 'thumb',
      }),
      { dayStartMs: day, url: 'thumb' }
    );
  });
});
