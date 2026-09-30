// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import * as Bytes from '../../Bytes.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { IMAGE_PNG } from '../../types/MIME.std.ts';
import { toOutgoingPreviewProto } from '../../linkPreviews/richContent.std.ts';
import {
  buildTestLinkPreview,
  buildTestRichBytes,
  encodeLengthDelimitedField,
} from '../../linkPreviews/testLinkPreview.std.ts';

// ADR-0063 §8.1 rows 2 and 10: the payload of the test send tool (plain JSON) becomes the preview
// the app's send path takes. The expected bytes below are written out by hand, field by field,
// not produced by the encoder that is under test.

const PNG_1X1 = Bytes.fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
);

function hex(...fields: Array<string>): string {
  return fields.join('');
}

// video / bilibili / schema 1 / level 2, each field as a key byte, a length and the bytes.
const VIDEO_KNOWN = hex(
  '0a05766964656f',
  '120862696c6962696c69',
  '1801',
  '3002'
);

// Field 99, length-delimited, as a newer sender would add it: key 99 << 3 | 2 = 0x9a 0x06.
const NEWER = Bytes.fromString('from a newer client');
const FIELD_99 = hex('9a06', '13', Bytes.toHex(NEWER));

describe('the payload of the test send tool', () => {
  describe('encodeLengthDelimitedField', () => {
    it('writes the key and the length as varints', () => {
      assert.strictEqual(
        Bytes.toHex(encodeLengthDelimitedField(1, Bytes.fromString('ab'))),
        '0a026162'
      );
      assert.strictEqual(
        Bytes.toHex(encodeLengthDelimitedField(99, NEWER)),
        FIELD_99
      );
      // 1000 << 3 | 2 = 8002 = 0xc2 0x3e (Preview.rich), and a length of 200 takes two bytes.
      const long = new Uint8Array(200).fill(7);
      assert.strictEqual(
        Bytes.toHex(encodeLengthDelimitedField(1000, long)).slice(0, 8),
        'c23ec801'
      );
    });

    it('refuses what is not a field number', () => {
      for (const field of [0, -1, 1.5, 0x20000000, Number.NaN]) {
        assert.throws(
          () => encodeLengthDelimitedField(field, new Uint8Array(0)),
          RangeError
        );
      }
    });
  });

  describe('rich built from its parts', () => {
    it('is the known fields in field order', () => {
      assert.strictEqual(
        Bytes.toHex(
          buildTestRichBytes({
            kind: 'video',
            provider: 'bilibili',
            schema: 1,
            level: 2,
          })
        ),
        VIDEO_KNOWN
      );
    });

    it('has the attributes one after the other, in the order given', () => {
      assert.strictEqual(
        Bytes.toHex(
          buildTestRichBytes({
            attrs: [
              { key: 'author', value: 'Kai' },
              { key: 'duration_ms', value: '1' },
            ],
          })
        ),
        // field 5, length 13 = (2 + 6) + (2 + 3): key (field 1) "author", value (field 2) "Kai"
        '2a0d' +
          '0a06617574686f72' +
          '1203' +
          '4b6169' +
          // field 5 again, length 16 = (2 + 11) + (2 + 1): key "duration_ms", value "1"
          '2a10' +
          '0a0b6475726174696f6e5f6d73' +
          '120131'
      );
    });

    it('has the fields this build does not know after the known ones, as a newer sender writes them', () => {
      assert.strictEqual(
        Bytes.toHex(
          buildTestRichBytes({
            kind: 'video',
            provider: 'bilibili',
            schema: 1,
            level: 2,
            unknownFields: [{ field: 99, hex: Bytes.toHex(NEWER) }],
          })
        ),
        VIDEO_KNOWN + FIELD_99
      );
    });

    it('writes what is wrong as it is: the point of a tool for testing receivers', () => {
      // A level that no platform gives a brand shell, a kind and a provider of 40 characters.
      const bytes = buildTestRichBytes({
        kind: 'k'.repeat(40),
        provider: 'p'.repeat(40),
        level: 2,
      });
      const decoded = Proto.RichContent.decode(bytes);
      assert.strictEqual(decoded.kind, 'k'.repeat(40));
      assert.strictEqual(decoded.provider, 'p'.repeat(40));
      assert.strictEqual(decoded.level, 2);
    });

    it('has nothing in it for nothing', () => {
      assert.lengthOf(buildTestRichBytes({}), 0);
    });

    it('refuses unknown fields that are not hex', () => {
      assert.throws(
        () =>
          buildTestRichBytes({ unknownFields: [{ field: 99, hex: 'nothex' }] }),
        TypeError,
        'not hex'
      );
    });
  });

  describe('buildTestLinkPreview', () => {
    const URL = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';

    it('keeps only what the payload gives', () => {
      const built = buildTestLinkPreview({
        body: `look ${URL}`,
        preview: { url: URL },
      });
      assert.deepEqual(built.preview, { url: URL });
      assert.strictEqual(built.body, `look ${URL}`);
      assert.isUndefined(built.richBytes);
    });

    it('takes the title, the description and the date, and treats null as not given', () => {
      assert.deepEqual(
        buildTestLinkPreview({
          body: URL,
          preview: {
            url: URL,
            title: 'A title',
            description: 'A description',
            date: 1_790_000_000_000,
          },
        }).preview,
        {
          url: URL,
          title: 'A title',
          description: 'A description',
          date: 1_790_000_000_000,
        }
      );
      assert.deepEqual(
        buildTestLinkPreview({
          body: URL,
          preview: { url: URL, title: null, description: null, date: null },
        }).preview,
        { url: URL }
      );
    });

    it('stores rich as base64 of its bytes, built from parts', () => {
      const built = buildTestLinkPreview({
        body: URL,
        preview: {
          url: URL,
          rich: { kind: 'video', provider: 'bilibili', schema: 1, level: 2 },
        },
      });
      assert.strictEqual(
        built.preview.rich,
        Bytes.toBase64(Bytes.fromHex(VIDEO_KNOWN))
      );
      assert.strictEqual(
        Bytes.toHex(built.richBytes ?? new Uint8Array(0)),
        VIDEO_KNOWN
      );
    });

    it('takes rich bytes as they are, hex or base64, in any order of fields', () => {
      // Unknown field 99 first, then `kind`: no encoder of this format writes it so.
      const odd = FIELD_99 + '0a05766964656f';
      const fromHex = buildTestLinkPreview({
        body: URL,
        preview: { url: URL, richHex: odd },
      });
      assert.strictEqual(
        Bytes.toHex(fromHex.richBytes ?? new Uint8Array(0)),
        odd
      );
      assert.strictEqual(
        fromHex.preview.rich,
        Bytes.toBase64(Bytes.fromHex(odd))
      );

      const fromBase64 = buildTestLinkPreview({
        body: URL,
        preview: { url: URL, richBase64: Bytes.toBase64(Bytes.fromHex(odd)) },
      });
      assert.deepEqual(fromBase64.preview.rich, fromHex.preview.rich);
    });

    it('takes at most one way to give rich', () => {
      assert.throws(
        () =>
          buildTestLinkPreview({
            body: URL,
            preview: { url: URL, rich: {}, richHex: '0a00' },
          }),
        TypeError,
        'at most one'
      );
      assert.throws(
        () =>
          buildTestLinkPreview({
            body: URL,
            preview: { url: URL, richHex: '0a00', richBase64: 'CgA=' },
          }),
        TypeError,
        'at most one'
      );
    });

    it('refuses rich that is not hex or not base64', () => {
      assert.throws(
        () =>
          buildTestLinkPreview({
            body: URL,
            preview: { url: URL, richHex: 'abc' },
          }),
        TypeError,
        'richHex'
      );
      assert.throws(
        () =>
          buildTestLinkPreview({
            body: URL,
            preview: { url: URL, richBase64: 'not base64!' },
          }),
        TypeError,
        'richBase64'
      );
    });

    it('takes a picture: its type sniffed from the bytes, its size in pixels only if given', () => {
      const built = buildTestLinkPreview({
        body: URL,
        preview: { url: URL, imageBase64: Bytes.toBase64(PNG_1X1) },
      });
      assert.deepEqual(built.preview.image, {
        contentType: IMAGE_PNG,
        data: PNG_1X1,
        size: PNG_1X1.byteLength,
      });

      const lying = buildTestLinkPreview({
        body: URL,
        preview: {
          url: URL,
          imageBase64: Bytes.toBase64(PNG_1X1),
          imageWidth: 1200,
          imageHeight: 630,
        },
      });
      assert.strictEqual(lying.preview.image?.width, 1200);
      assert.strictEqual(lying.preview.image?.height, 630);
    });

    it('takes the type of the picture from the payload over the bytes', () => {
      const built = buildTestLinkPreview({
        body: URL,
        preview: {
          url: URL,
          imageBase64: Bytes.toBase64(PNG_1X1),
          imageContentType: 'image/jpeg',
        },
      });
      assert.strictEqual(built.preview.image?.contentType, 'image/jpeg');
    });

    it('refuses a picture that is not one, unless its type is given', () => {
      const notAnImage = Bytes.toBase64(Bytes.fromString('just some text'));
      assert.throws(
        () =>
          buildTestLinkPreview({
            body: URL,
            preview: { url: URL, imageBase64: notAnImage },
          }),
        TypeError,
        'imageContentType'
      );
      assert.strictEqual(
        buildTestLinkPreview({
          body: URL,
          preview: {
            url: URL,
            imageBase64: notAnImage,
            imageContentType: 'image/png',
          },
        }).preview.image?.contentType,
        'image/png'
      );
    });

    it('refuses a payload that is not one', () => {
      assert.throws(
        () => buildTestLinkPreview({ body: 5, preview: { url: URL } } as never),
        TypeError
      );
      assert.throws(
        () => buildTestLinkPreview({ body: 'x', preview: {} } as never),
        TypeError
      );
      assert.throws(
        () => buildTestLinkPreview({ body: 'x' } as never),
        TypeError
      );
    });
  });

  // What the app's send path does with it: the preview goes through `toOutgoingPreviewProto`, the
  // function that writes `DataMessage.preview` on the wire for every message.
  describe('on the wire, through the send path', () => {
    const URL = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';

    function wireRich(
      input: Parameters<typeof buildTestLinkPreview>[0]
    ): Uint8Array<ArrayBuffer> | null {
      const { preview } = buildTestLinkPreview(input);
      const bytes = Proto.Preview.encode(
        toOutgoingPreviewProto({ ...preview, image: undefined })
      );
      const decoded = Proto.Preview.decode(bytes);
      return decoded.rich ? Proto.RichContent.encode(decoded.rich) : null;
    }

    it('keeps the bytes of rich built from parts, unknown fields included', () => {
      const expected = Bytes.fromHex(VIDEO_KNOWN + FIELD_99);
      const sent = wireRich({
        body: URL,
        preview: {
          url: URL,
          rich: {
            kind: 'video',
            provider: 'bilibili',
            schema: 1,
            level: 2,
            unknownFields: [{ field: 99, hex: Bytes.toHex(NEWER) }],
          },
        },
      });
      assert.isNotNull(sent);
      assert.isTrue(Bytes.areEqual(sent ?? new Uint8Array(0), expected));
    });

    it('keeps raw bytes that are in the order every encoder writes them', () => {
      const raw = VIDEO_KNOWN + FIELD_99;
      const sent = wireRich({
        body: URL,
        preview: { url: URL, richHex: raw },
      });
      assert.strictEqual(Bytes.toHex(sent ?? new Uint8Array(0)), raw);
    });

    it('writes raw bytes in the order of any encoder, known fields first: an unknown field given first comes out last', () => {
      // Given: field 99, then `kind`. The send path decodes and encodes the message's rich on
      // every send and forward, so what goes out is `kind` first: the tool says so, and the
      // bytes to give are the ones above.
      const given = FIELD_99 + '0a05766964656f';
      const sent = wireRich({
        body: URL,
        preview: { url: URL, richHex: given },
      });
      assert.strictEqual(
        Bytes.toHex(sent ?? new Uint8Array(0)),
        '0a05766964656f' + FIELD_99
      );
    });
  });
});
