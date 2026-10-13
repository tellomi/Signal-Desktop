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
  APPLICATION_OCTET_STREAM,
  IMAGE_JPEG,
  IMAGE_PNG,
  VIDEO_MP4,
} from '../types/MIME.std.ts';
import type { MIMEType } from '../types/MIME.std.ts';
import type { MessageAttributesType } from '../model-types.d.ts';
import { isTellomiSpoilerCovered } from '../util/Attachment.std.ts';

// ADR-0068 §4.1 / §4.3, spec R-1 (tellomi/tellomi#1263): an image / video received with
// `AttachmentPointer.tellomi.spoiler` stays covered until uncovered on this device.
describe('Tellomi: covered (spoiler) images and videos (ADR-0068, spec R-1)', () => {
  const TIMESTAMP = Date.now();

  function pointer(
    contentType: MIMEType,
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
      contentType,
      incrementalMac: null,
      chunkSize: null,
      uploadTimestamp: 456n,
      size: 2048,
      height: 3024,
      width: 4032,
      flags: null,
      fileName: null,
      thumbnail: null,
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
          requiredProtocolVersion:
            Proto.DataMessage.ProtocolVersion.TELLOMI_MEDIA_SPOILER,
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

  const spoiler = { asFile: null, spoiler: true, livePhotoVideo: null };

  describe('the wire', () => {
    it('accepts messages that need the spoiler version, golden bytes shared by the three clients', () => {
      assert.strictEqual(
        Proto.DataMessage.ProtocolVersion.TELLOMI_MEDIA_SPOILER,
        9
      );
      assert.strictEqual(Proto.DataMessage.ProtocolVersion.CURRENT, 9);

      // key = 1001 << 3 | 2 = ca 3e; TellomiAttachment{spoiler = true} = 10 01
      const onlyTellomi = Proto.AttachmentPointer.decode(
        Bytes.fromHex('ca3e021001')
      );
      assert.isTrue(onlyTellomi.tellomi?.spoiler);
    });

    it('covers images and videos only; sent as a file wins; anything else is ignored', () => {
      const out = receive([
        pointer(IMAGE_JPEG, spoiler),
        pointer(VIDEO_MP4, spoiler),
        pointer(IMAGE_PNG, { ...spoiler, asFile: true }),
        pointer(APPLICATION_OCTET_STREAM, spoiler),
        pointer(IMAGE_JPEG, { ...spoiler, spoiler: false }),
        pointer(IMAGE_JPEG, null),
      ]);

      assert.isTrue(out.attachments[0]?.tellomiSpoiler);
      assert.isTrue(out.attachments[1]?.tellomiSpoiler);
      assert.notProperty(out.attachments[2], 'tellomiSpoiler');
      assert.isTrue(out.attachments[2]?.tellomiAsFile);
      assert.notProperty(out.attachments[3], 'tellomiSpoiler');
      assert.notProperty(out.attachments[4], 'tellomiSpoiler');
      assert.notProperty(out.attachments[5], 'tellomiSpoiler');
      // The message itself is received either way.
      assert.lengthOf(out.attachments, 6);
    });
  });

  it('is covered until uncovered here', () => {
    assert.isTrue(isTellomiSpoilerCovered({ tellomiSpoiler: true }));
    assert.isFalse(
      isTellomiSpoilerCovered({
        tellomiSpoiler: true,
        tellomiSpoilerRevealed: true,
      })
    );
    assert.isFalse(isTellomiSpoilerCovered({}));
    assert.isFalse(isTellomiSpoilerCovered(undefined));
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

    it('keeps the cover and the reveal through the database', () => {
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
            contentType: IMAGE_JPEG,
            size: 2048,
            path: 'ab/covered',
            tellomiSpoiler: true,
          },
          {
            contentType: IMAGE_JPEG,
            size: 2048,
            path: 'cd/uncovered',
            tellomiSpoiler: true,
            tellomiSpoilerRevealed: true,
          },
          {
            contentType: IMAGE_JPEG,
            size: 1024,
            path: 'ef/photo',
          },
        ],
      };
      DataWriter.saveMessage(db, message, { forceSave: true, ourAci });

      const loaded = DataReader.getMessageById(db, id)?.attachments ?? [];
      assert.isTrue(isTellomiSpoilerCovered(loaded[0]));
      assert.isTrue(loaded[1]?.tellomiSpoiler);
      assert.isFalse(isTellomiSpoilerCovered(loaded[1]));
      assert.notOk(loaded[2]?.tellomiSpoiler);
      assert.isFalse(isTellomiSpoilerCovered(loaded[2]));
    });
  });
});
