// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { cwd } from 'node:process';
import { assert } from 'chai';
import { v4 as generateUuid } from 'uuid';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { DataReader, DataWriter, setupTests } from '../../sql/Server.node.ts';
import { createDB } from './helpers.node.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import { IMAGE_JPEG, VIDEO_MP4 } from '../../types/MIME.std.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import {
  TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG,
  localMonthIntervalMs,
} from '../../util/tellomiConversationDayThumbnails.std.ts';
import { startOfLocalDayMs } from '../../util/tellomiJumpToDate.std.ts';

describe('tellomiCalendarGalleryMedia', () => {
  let db: WritableDB;
  const ourAci = generateAci();
  const conversationId = generateUuid();

  beforeEach(() => {
    db = createDB();
    setupTests(db, { userDataPath: cwd() });
  });

  afterEach(() => {
    db.close();
  });

  function save(options: {
    sentAt: number;
    receivedAtMs: number;
    receivedAt: number;
    attachments: MessageAttributesType['attachments'];
    isViewOnce?: boolean;
  }): void {
    const message: MessageAttributesType = {
      id: generateUuid(),
      conversationId,
      type: 'incoming',
      sent_at: options.sentAt,
      received_at: options.receivedAt,
      received_at_ms: options.receivedAtMs,
      timestamp: options.sentAt,
      isViewOnce: options.isViewOnce,
      attachments: options.attachments,
    };
    DataWriter.saveMessage(db, message, { forceSave: true, ourAci });
  }

  it('returns the first all-media gallery attachment for each receipt day', () => {
    const morning = new Date(2026, 9, 26, 9, 0, 0).getTime();
    const afternoon = new Date(2026, 9, 26, 15, 0, 0).getTime();
    const nextDay = new Date(2026, 9, 27, 8, 0, 0).getTime();
    const november = new Date(2026, 10, 2, 8, 0, 0).getTime();

    save({
      sentAt: morning,
      receivedAtMs: morning,
      receivedAt: 1,
      isViewOnce: true,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'view-once',
          fileName: 'view-once.jpg',
        },
      ],
    });
    save({
      sentAt: morning - 1,
      receivedAtMs: morning - 1,
      receivedAt: 2,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'as-file',
          fileName: 'as-file.jpg',
          tellomiAsFile: true,
        },
      ],
    });
    save({
      sentAt: morning,
      receivedAtMs: afternoon,
      receivedAt: 3,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'late',
          fileName: 'late.jpg',
        },
      ],
    });
    save({
      sentAt: morning - 2,
      receivedAtMs: morning - 2,
      receivedAt: 4,
      attachments: [
        {
          contentType: 'application/pdf',
          size: 10,
          path: 'doc',
          fileName: 'notes.pdf',
        },
      ],
    });
    save({
      sentAt: morning - 3,
      receivedAtMs: morning - 3,
      receivedAt: 5,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'voice-flag',
          fileName: 'voice-flag.jpg',
          flags: TELLOMI_ALL_MEDIA_VOICE_MESSAGE_FLAG,
        },
      ],
    });
    // Earliest real gallery receipt that day. Array order is orderInMessage, so
    // the first album image wins over the second and over a later same-day photo.
    save({
      sentAt: morning,
      receivedAtMs: morning,
      receivedAt: 6,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'album-0',
          fileName: 'album-0.jpg',
        },
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'album-1',
          fileName: 'album-1.jpg',
        },
      ],
    });
    save({
      sentAt: morning + 1,
      receivedAtMs: morning,
      receivedAt: 7,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'same-instant-later-send',
          fileName: 'same-instant-later-send.jpg',
        },
      ],
    });
    save({
      sentAt: nextDay,
      receivedAtMs: nextDay,
      receivedAt: 8,
      attachments: [
        {
          contentType: VIDEO_MP4,
          size: 10,
          path: 'clip',
          fileName: 'clip.mp4',
          thumbnail: {
            contentType: IMAGE_JPEG,
            size: 4,
            path: 'clip-thumb',
          },
        },
      ],
    });
    save({
      sentAt: november,
      receivedAtMs: november,
      receivedAt: 9,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'nov',
          fileName: 'nov.jpg',
        },
      ],
    });

    const { startMs, endMs } = localMonthIntervalMs(2026, 10);
    const rows = DataReader.getTellomiCalendarGalleryMedia(db, conversationId, {
      startMs,
      endMs,
    });

    const byDay = new Map(rows.map(row => [row.bucketMs, row]));
    assert.strictEqual(rows.length, 2);

    const day26 = rows.find(
      row => startOfLocalDayMs(row.bucketMs) === startOfLocalDayMs(morning)
    );
    const day27 = rows.find(
      row => startOfLocalDayMs(row.bucketMs) === startOfLocalDayMs(nextDay)
    );
    assert.strictEqual(day26?.attachment.fileName, 'album-0.jpg');
    assert.strictEqual(day26?.orderInMessage, 0);
    assert.strictEqual(day26?.sentAt, morning);
    assert.strictEqual(day27?.attachment.fileName, 'clip.mp4');
    assert.strictEqual(day27?.attachment.thumbnail?.path, 'clip-thumb');
    assert.isFalse(byDay.has(november));
  });

  it('buckets by receipt time when it crosses local midnight', () => {
    const sent = new Date(2026, 9, 26, 23, 50, 0).getTime();
    const received = new Date(2026, 9, 27, 0, 10, 0).getTime();
    save({
      sentAt: sent,
      receivedAtMs: received,
      receivedAt: 1,
      attachments: [
        {
          contentType: IMAGE_JPEG,
          size: 10,
          path: 'late-night',
          fileName: 'late-night.jpg',
        },
      ],
    });

    const { startMs, endMs } = localMonthIntervalMs(2026, 10);
    const rows = DataReader.getTellomiCalendarGalleryMedia(db, conversationId, {
      startMs,
      endMs,
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(
      startOfLocalDayMs(rows[0]?.bucketMs ?? 0),
      startOfLocalDayMs(received)
    );
    assert.notStrictEqual(
      startOfLocalDayMs(rows[0]?.bucketMs ?? 0),
      startOfLocalDayMs(sent)
    );
  });
});
