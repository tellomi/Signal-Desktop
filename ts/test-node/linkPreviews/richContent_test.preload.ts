// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { cwd } from 'node:process';
import { assert } from 'chai';
import lodash from 'lodash';
import { v4 as generateUuid } from 'uuid';

import { SignalService as Proto } from '../../protobuf/index.std.ts';
import * as Bytes from '../../Bytes.std.ts';
import { processDataMessage } from '../../textsecure/processDataMessage.preload.ts';
import {
  richFromReceivedPreview,
  toOutgoingPreviewProto,
} from '../../linkPreviews/richContent.std.ts';
import type { WritableDB } from '../../sql/Interface.std.ts';
import { DataReader, DataWriter, setupTests } from '../../sql/Server.node.ts';
import { createDB } from '../sql/helpers.node.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import { IMAGE_JPEG } from '../../types/MIME.std.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';

const { omit } = lodash;

// ADR-0063 §4.5 / §7.4 (tellomi/tellomi#1420): `Preview.rich = 1000`.

function varint(value: number): Uint8Array<ArrayBuffer> {
  const out: Array<number> = [];
  let rest = value;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return new Uint8Array(out);
}

// key = 1000 << 3 | 2 (length-delimited)
const RICH_KEY = new Uint8Array([0xc2, 0x3e]);

function field1000(rich: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return Bytes.concatenate([RICH_KEY, varint(rich.length), rich]);
}

const KNOWN_RICH: Proto.RichContent.Params = {
  kind: 'video',
  provider: 'bilibili',
  schema: 1,
  canonicalUrl: 'https://www.bilibili.com/video/BV1GJ411x7h7',
  attrs: [
    { key: 'author', value: '某位 UP 主' },
    { key: 'duration_ms', value: '212000' },
  ],
  level: 2,
};

// A field this build does not know (99, length-delimited), as a newer sender would add it.
const UNKNOWN_PAYLOAD = Bytes.fromString('from a newer client');
const UNKNOWN_FIELD_99 = Bytes.concatenate([
  new Uint8Array([0x9a, 0x06]), // key = 99 << 3 | 2
  varint(UNKNOWN_PAYLOAD.length),
  UNKNOWN_PAYLOAD,
]);

const RICH_BYTES = Bytes.concatenate([
  Proto.RichContent.encode(KNOWN_RICH),
  UNKNOWN_FIELD_99,
]);

const IMAGE: Proto.AttachmentPointer.Params = {
  attachmentIdentifier: { cdnKey: 'cdnKey' },
  cdnNumber: 2,
  blurHash: null,
  caption: null,
  clientUuid: null,
  key: new Uint8Array([1, 2, 3]),
  digest: new Uint8Array([4, 5, 6]),
  contentType: IMAGE_JPEG,
  incrementalMac: null,
  chunkSize: null,
  uploadTimestamp: 456n,
  size: 34,
  height: 630,
  width: 1200,
  flags: null,
  fileName: null,
  thumbnail: null,
};

const SNAPSHOT: Omit<Proto.Preview.Params, 'rich'> = {
  url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
  title: '某个视频的标题',
  image: IMAGE,
  description: '视频简介',
  date: 1790000000000n,
};

const BODY = `看这个 ${SNAPSHOT.url}`;

// The bytes a sender puts on the wire: the snapshot, then field 1000 carrying RICH_BYTES verbatim.
function receivedDataMessage({
  withRich,
}: {
  withRich: boolean;
}): Proto.DataMessage {
  const preview: Proto.Preview.Params = {
    ...SNAPSHOT,
    rich: null,
    $unknown: withRich ? [field1000(RICH_BYTES)] : null,
  };
  return Proto.DataMessage.decode(
    Proto.DataMessage.encode({
      body: BODY,
      attachments: null,
      groupV2: null,
      flags: null,
      expireTimer: null,
      expireTimerVersion: null,
      profileKey: null,
      timestamp: 1790000000001n,
      quote: null,
      contact: null,
      preview: [preview],
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
    })
  );
}

function processReceived(withRich: boolean) {
  return processDataMessage(receivedDataMessage({ withRich }), 1790000000001, {
    _createName: () => 'random-path',
  });
}

describe('Preview.rich = 1000 (ADR-0063 §4.5 / §7.4)', () => {
  it('uses the field numbers and types of rust/links/proto/rich_content.proto', () => {
    // The same value and expected bytes as rust/links/src/rich.rs `field_numbers_match_the_adr`.
    const bytes = Proto.RichContent.encode({
      kind: 'video',
      provider: 'bilibili',
      schema: 1,
      canonicalUrl: 'u',
      attrs: [{ key: 'k', value: 'v' }],
      level: 2,
    });
    assert.strictEqual(
      Bytes.toHex(bytes),
      '0a05766964656f120862696c6962696c6918012201752a060a016b1201763002'
    );

    const empty: Proto.RichContent.Params = {
      kind: null,
      provider: null,
      schema: null,
      canonicalUrl: null,
      attrs: null,
      level: null,
    };
    const previewRichOnly = Proto.Preview.encode({
      url: null,
      title: null,
      image: null,
      description: null,
      date: null,
      rich: empty,
    });
    assert.strictEqual(Bytes.toHex(previewRichOnly), 'c23e00');
  });

  it('shows the same snapshot whether or not the preview carries rich', () => {
    const withRich = processReceived(true);
    const withoutRich = processReceived(false);

    assert.isDefined(withRich.preview?.[0]?.rich);
    assert.deepStrictEqual(
      withRich.preview?.map(preview => omit(preview, 'rich')),
      withoutRich.preview
    );
    assert.strictEqual(withRich.preview?.[0]?.title, SNAPSHOT.title);
    assert.strictEqual(
      withRich.preview?.[0]?.description,
      SNAPSHOT.description
    );
    assert.strictEqual(withRich.preview?.[0]?.image?.cdnKey, 'cdnKey');
    assert.isUndefined(withoutRich.preview?.[0]?.rich);
  });

  describe('receive → persist → load → forward keeps the bytes', () => {
    let db: WritableDB;
    const ourAci = generateAci();

    beforeEach(() => {
      db = createDB();
      setupTests(db, { userDataPath: cwd() });
    });

    afterEach(() => {
      db.close();
    });

    it('re-emits the received rich byte for byte, unknown field 99 included', () => {
      const received = processReceived(true);
      const receivedPreview = received.preview?.[0];
      assert.isDefined(receivedPreview);
      assert.strictEqual(receivedPreview?.rich, Bytes.toBase64(RICH_BYTES));

      const id = generateUuid();
      const message: MessageAttributesType = {
        id,
        conversationId: generateUuid(),
        type: 'incoming',
        body: BODY,
        sent_at: 1790000000001,
        received_at: 1,
        timestamp: 1790000000001,
        preview: [
          {
            url: receivedPreview?.url ?? '',
            title: receivedPreview?.title,
            description: receivedPreview?.description,
            date: receivedPreview?.date,
            rich: receivedPreview?.rich,
          },
        ],
      };
      DataWriter.saveMessage(db, message, { forceSave: true, ourAci });

      const loaded = DataReader.getMessageById(db, id);
      const loadedPreview = loaded?.preview?.[0];
      assert.strictEqual(loadedPreview?.rich, Bytes.toBase64(RICH_BYTES));

      // Forward: the stored preview goes back out through the same builder the send job uses.
      const outgoing = toOutgoingPreviewProto({
        url: loadedPreview?.url ?? '',
        title: loadedPreview?.title,
        description: loadedPreview?.description,
        date: loadedPreview?.date,
        rich: loadedPreview?.rich,
      });
      const encoded = Proto.Preview.encode(outgoing);
      const expected = Bytes.concatenate([
        Proto.Preview.encode({ ...outgoing, rich: null }),
        field1000(RICH_BYTES),
      ]);
      assert.strictEqual(Bytes.toHex(encoded), Bytes.toHex(expected));

      // …and a receiver decoding it again stores the very same bytes.
      assert.strictEqual(
        richFromReceivedPreview(Proto.Preview.decode(encoded)),
        Bytes.toBase64(RICH_BYTES)
      );
    });
  });

  describe('sending', () => {
    const outgoingSnapshot = {
      url: SNAPSHOT.url ?? '',
      title: SNAPSHOT.title ?? undefined,
      description: SNAPSHOT.description ?? undefined,
      date: 1790000000000,
    };

    it('puts attached rich bytes on the wire unchanged', () => {
      const encoded = Proto.Preview.encode(
        toOutgoingPreviewProto({
          ...outgoingSnapshot,
          rich: Bytes.toBase64(RICH_BYTES),
        })
      );
      const withoutRich = Proto.Preview.encode(
        toOutgoingPreviewProto(outgoingSnapshot)
      );
      assert.strictEqual(
        Bytes.toHex(encoded),
        Bytes.toHex(Bytes.concatenate([withoutRich, field1000(RICH_BYTES)]))
      );
    });

    it('without rich, encodes exactly what the upstream builder did', () => {
      const encoded = Proto.Preview.encode(
        toOutgoingPreviewProto(outgoingSnapshot)
      );
      // The upstream SendMessage mapping, before field 1000 existed.
      const upstream = Proto.Preview.encode({
        title: outgoingSnapshot.title ?? null,
        url: outgoingSnapshot.url,
        description: outgoingSnapshot.description ?? null,
        date: BigInt(outgoingSnapshot.date),
        image: null,
        rich: null,
      });
      assert.strictEqual(Bytes.toHex(encoded), Bytes.toHex(upstream));
      assert.notInclude(Bytes.toHex(encoded), 'c23e');
    });

    it('drops a stored value that no longer parses instead of failing the send', () => {
      const params = toOutgoingPreviewProto({
        ...outgoingSnapshot,
        rich: Bytes.toBase64(new Uint8Array([0xff, 0xff, 0xff])),
      });
      assert.isNull(params.rich);
    });
  });
});
