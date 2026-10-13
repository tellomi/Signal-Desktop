// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { cwd } from 'node:process';
import { assert } from 'chai';
import { v4 as generateUuid } from 'uuid';

import * as Bytes from '../Bytes.std.ts';
import { SignalService as Proto } from '../protobuf/index.std.ts';
import { processDataMessage } from '../textsecure/processDataMessage.preload.ts';
import type { WritableDB } from '../sql/Interface.std.ts';
import { DataReader, DataWriter, setupTests } from '../sql/Server.node.ts';
import { createDB } from './sql/helpers.node.ts';
import { generateAci } from '../test-helpers/serviceIdUtils.std.ts';
import { IMAGE_JPEG, IMAGE_PNG, VIDEO_MP4 } from '../types/MIME.std.ts';
import type { MIMEType } from '../types/MIME.std.ts';
import type { MessageAttributesType } from '../model-types.d.ts';

// ADR-0068 §4.1, spec R-2 (tellomi/tellomi#1263): a live photo's moving half
// (`AttachmentPointer.tellomi.livePhotoVideo`) is kept with the still, and only when it is valid.
describe('Tellomi: live photos (ADR-0068, spec R-2)', () => {
  const TIMESTAMP = Date.now();

  function video(
    overrides: Partial<Proto.AttachmentPointer.Params> = {}
  ): Proto.AttachmentPointer.Params {
    return {
      attachmentIdentifier: { cdnKey: 'cdn-key-video' },
      cdnNumber: 3,
      blurHash: null,
      caption: null,
      clientUuid: null,
      key: new Uint8Array(64).fill(7),
      digest: new Uint8Array(32).fill(9),
      contentType: VIDEO_MP4,
      incrementalMac: null,
      chunkSize: null,
      uploadTimestamp: 456n,
      size: 456789,
      height: null,
      width: null,
      flags: null,
      fileName: null,
      thumbnail: null,
      tellomi: null,
      ...overrides,
    };
  }

  function still(
    contentType: MIMEType,
    tellomi: Proto.TellomiAttachment.Params | null
  ): Proto.AttachmentPointer.Params {
    return {
      ...video({ attachmentIdentifier: { cdnKey: 'cdn-key-still' } }),
      contentType,
      tellomi,
    };
  }

  function receive(attachments: Array<Proto.AttachmentPointer.Params>) {
    return processDataMessage(
      Proto.DataMessage.decode(
        Proto.DataMessage.encode({
          body: null,
          attachments,
          groupV2: null,
          flags: null,
          expireTimer: null,
          expireTimerVersion: null,
          profileKey: null,
          timestamp: BigInt(TIMESTAMP),
          quote: null,
          contact: null,
          preview: null,
          sticker: null,
          requiredProtocolVersion: null,
          isViewOnce: null,
          reaction: null,
          delete: null,
          bodyRanges: null,
          groupCallUpdate: null,
          payment: null,
          storyContext: null,
          giftBadge: null,
          pollCreate: null,
          pollTerminate: null,
          pollVote: null,
          pinMessage: null,
          unpinMessage: null,
          adminDelete: null,
          tellomi: null,
        })
      ),
      TIMESTAMP,
      { _createName: () => 'random-path' }
    );
  }

  const live = (
    livePhotoVideo: Proto.AttachmentPointer.Params,
    extra: Partial<Proto.TellomiAttachment.Params> = {}
  ): Proto.TellomiAttachment.Params => ({
    asFile: null,
    spoiler: null,
    livePhotoVideo,
    ...extra,
  });

  it('decodes the golden bytes shared by the three clients', () => {
    // key = 1001 << 3 | 2 = ca 3e; TellomiAttachment{livePhotoVideo = {}} = 1a 00
    const onlyTellomi = Proto.AttachmentPointer.decode(
      Bytes.fromHex('ca3e021a00')
    );
    assert.isDefined(onlyTellomi.tellomi?.livePhotoVideo);
  });

  it('keeps a valid moving half on the still, and ignores everything else', () => {
    const out = receive([
      still(IMAGE_PNG, live(video())),
      still(IMAGE_JPEG, live(video(), { spoiler: true })),
      still(IMAGE_PNG, live(video(), { asFile: true })),
      still(VIDEO_MP4, live(video())),
      still(IMAGE_PNG, live(video({ contentType: IMAGE_JPEG }))),
      still(IMAGE_PNG, live(video({ tellomi: live(video()) }))),
      still(IMAGE_PNG, live(video({ attachmentIdentifier: null }))),
      still(IMAGE_PNG, live(video({ digest: null }))),
      still(IMAGE_PNG, null),
    ]);

    assert.strictEqual(
      out.attachments[0]?.tellomiLivePhotoVideo?.cdnKey,
      'cdn-key-video'
    );
    assert.strictEqual(
      out.attachments[0]?.tellomiLivePhotoVideo?.contentType,
      VIDEO_MP4
    );
    assert.isDefined(
      out.attachments[1]?.tellomiLivePhotoVideo,
      'covered live photo'
    );
    assert.isTrue(out.attachments[1]?.tellomiSpoiler);
    for (const index of [2, 3, 4, 5, 6, 7, 8]) {
      assert.notProperty(
        out.attachments[index],
        'tellomiLivePhotoVideo',
        `#${index}`
      );
    }
    // The message itself is received either way, one attachment per picture.
    assert.lengthOf(out.attachments, 9);
  });

  describe('stored and loaded', () => {
    let db: WritableDB;
    const ourAci = generateAci();

    beforeEach(() => {
      db = createDB();
      setupTests(db, { userDataPath: cwd() });
    });

    afterEach(() => {
      db.close();
    });

    it('keeps the moving half through the database', () => {
      const id = generateUuid();
      const message: MessageAttributesType = {
        id,
        conversationId: generateUuid(),
        type: 'incoming',
        sent_at: TIMESTAMP,
        received_at: 1,
        timestamp: TIMESTAMP,
        attachments: [
          {
            contentType: IMAGE_PNG,
            size: 2048,
            path: 'ab/live',
            tellomiLivePhotoVideo: {
              contentType: VIDEO_MP4,
              size: 456789,
              cdnKey: 'cdn-key-video',
              cdnNumber: 3,
            },
          },
          { contentType: IMAGE_JPEG, size: 1024, path: 'cd/photo' },
        ],
      };
      DataWriter.saveMessage(db, message, { forceSave: true, ourAci });

      const loaded = DataReader.getMessageById(db, id)?.attachments ?? [];
      assert.strictEqual(
        loaded[0]?.tellomiLivePhotoVideo?.cdnKey,
        'cdn-key-video'
      );
      assert.notOk(loaded[1]?.tellomiLivePhotoVideo);
    });
  });
});
