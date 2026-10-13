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
import {
  AUDIO_AAC,
  IMAGE_GIF,
  IMAGE_JPEG,
  IMAGE_PNG,
  VIDEO_MP4,
} from '../types/MIME.std.ts';
import type { AttachmentType } from '../types/Attachment.std.ts';
import type { MessageAttributesType } from '../model-types.d.ts';
import {
  isAudio,
  isFile,
  isGIF,
  isImage,
  isTellomiAsFile,
  isVideo,
  isVisualMedia,
} from '../util/Attachment.std.ts';

// ADR-0068 (tellomi/tellomi#1263): an attachment received with `AttachmentPointer.tellomi.asFile` is a
// file row whatever its content type, and is listed with files, not with media.
describe('Tellomi: attachments sent as a file (ADR-0068)', () => {
  const TIMESTAMP = Date.now();

  function pointer(
    tellomi: Proto.TellomiAttachment.Params | null
  ): Proto.AttachmentPointer.Params {
    return {
      attachmentIdentifier: { cdnKey: 'cdnKey' },
      cdnNumber: 3,
      blurHash: null,
      caption: null,
      clientUuid: null,
      key: new Uint8Array([1, 2, 3]),
      digest: new Uint8Array([4, 5, 6]),
      contentType: IMAGE_PNG,
      incrementalMac: null,
      chunkSize: null,
      uploadTimestamp: 456n,
      size: 2048,
      height: 3024,
      width: 4032,
      flags: null,
      fileName: 'IMG_0001.PNG',
      thumbnail: null,
      tellomi,
    };
  }

  describe('the wire', () => {
    it('uses the field numbers ADR-0068 gives, golden bytes shared by the three clients', () => {
      // key = 1001 << 3 | 2 = ca 3e; TellomiAttachment{asFile = true} = 08 01
      const onlyTellomi = Proto.AttachmentPointer.decode(
        Bytes.fromHex('ca3e020801')
      );
      assert.isTrue(onlyTellomi.tellomi?.asFile);

      // key = 1000 << 3 | 2 = c2 3e; TellomiDataMessage{captionAboveMedia = true} = 08 01
      const dataMessage = Proto.DataMessage.decode(Bytes.fromHex('c23e020801'));
      assert.isTrue(dataMessage.tellomi?.captionAboveMedia);
    });

    it('processes asFile from the pointer, and only when it is true', () => {
      const out = processDataMessage(
        Proto.DataMessage.decode(
          Proto.DataMessage.encode({
            body: null,
            attachments: [
              pointer({ asFile: true, spoiler: null, livePhotoVideo: null }),
              pointer({ asFile: false, spoiler: null, livePhotoVideo: null }),
              pointer(null),
            ],
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

      assert.isTrue(out.attachments[0]?.tellomiAsFile);
      assert.notProperty(out.attachments[1], 'tellomiAsFile');
      assert.notProperty(out.attachments[2], 'tellomiAsFile');
    });
  });

  // ADR-0068 §4.7: the caption above the media, a message-level flag.
  describe('caption above media', () => {
    function dataMessage(
      tellomi: Proto.TellomiDataMessage.Params | null
    ): Proto.DataMessage {
      return Proto.DataMessage.decode(
        Proto.DataMessage.encode({
          body: 'caption',
          attachments: [pointer(null)],
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
          tellomi,
        })
      );
    }

    it('is kept from the data message, and only when it is true', () => {
      const above = processDataMessage(
        dataMessage({ captionAboveMedia: true }),
        TIMESTAMP,
        { _createName: () => 'random-path' }
      );
      const no = processDataMessage(
        dataMessage({ captionAboveMedia: false }),
        TIMESTAMP,
        { _createName: () => 'random-path' }
      );
      const ordinary = processDataMessage(dataMessage(null), TIMESTAMP, {
        _createName: () => 'random-path',
      });

      assert.isTrue(above.tellomiCaptionAboveMedia);
      assert.notProperty(no, 'tellomiCaptionAboveMedia');
      assert.notProperty(ordinary, 'tellomiCaptionAboveMedia');
    });
  });

  describe('the checks that decide how it is drawn and listed', () => {
    const asFile = (contentType: AttachmentType['contentType']) =>
      ({ contentType, size: 1, tellomiAsFile: true }) as const;
    const ordinary = (contentType: AttachmentType['contentType']) =>
      ({ contentType, size: 1 }) as const;

    it('is never media, whatever the content type', () => {
      assert.isTrue(isTellomiAsFile(asFile(IMAGE_PNG)));
      assert.isFalse(isImage([asFile(IMAGE_PNG)]));
      assert.isFalse(isVideo([asFile(VIDEO_MP4)]));
      assert.isFalse(isGIF([{ ...asFile(VIDEO_MP4), flags: 8 }]));
      assert.isFalse(isAudio([asFile(AUDIO_AAC)]));
      assert.isFalse(isVisualMedia(asFile(IMAGE_JPEG)));
      assert.isTrue(isFile(asFile(IMAGE_JPEG)));
      assert.isTrue(isFile(asFile(VIDEO_MP4)));
    });

    it('leaves ordinary attachments as they were', () => {
      assert.isTrue(isImage([ordinary(IMAGE_PNG)]));
      assert.isTrue(isVideo([ordinary(VIDEO_MP4)]));
      assert.isTrue(isGIF([{ ...ordinary(VIDEO_MP4), flags: 8 }]));
      assert.isTrue(isAudio([ordinary(AUDIO_AAC)]));
      assert.isTrue(isVisualMedia(ordinary(IMAGE_GIF)));
      assert.isFalse(isFile(ordinary(IMAGE_JPEG)));
    });
  });

  describe('stored, loaded and listed', () => {
    let db: WritableDB;
    const ourAci = generateAci();

    beforeEach(() => {
      db = createDB();
      setupTests(db, { userDataPath: cwd() });
    });

    afterEach(() => {
      db.close();
    });

    it('keeps the flag through the database and lists it with documents, not media', () => {
      const conversationId = generateUuid();
      const id = generateUuid();
      const message: MessageAttributesType = {
        id,
        conversationId,
        type: 'incoming',
        sent_at: TIMESTAMP,
        received_at: 1,
        timestamp: TIMESTAMP,
        attachments: [
          {
            contentType: IMAGE_PNG,
            size: 2048,
            path: 'ab/asfile',
            fileName: 'IMG_0001.PNG',
            tellomiAsFile: true,
          },
          {
            contentType: IMAGE_JPEG,
            size: 1024,
            path: 'cd/photo',
            fileName: 'IMG_0002.JPG',
          },
        ],
      };
      DataWriter.saveMessage(db, message, { forceSave: true, ourAci });

      const loaded = DataReader.getMessageById(db, id);
      assert.isTrue(loaded?.attachments?.[0]?.tellomiAsFile);
      assert.notOk(loaded?.attachments?.[1]?.tellomiAsFile);

      const listed = (type: 'media' | 'documents') =>
        DataReader.getSortedMedia(db, {
          conversationId,
          limit: 10,
          order: 'older',
          type,
        }).map(item => item.attachment.fileName);
      assert.deepEqual(listed('media'), ['IMG_0002.JPG']);
      assert.deepEqual(listed('documents'), ['IMG_0001.PNG']);
    });
  });
});
