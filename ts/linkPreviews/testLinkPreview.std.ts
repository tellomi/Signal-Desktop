// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { SignalService as Proto } from '../protobuf/index.std.ts';
import * as Bytes from '../Bytes.std.ts';
import { stringToMIMEType } from '../types/MIME.std.ts';
import type { AttachmentWithHydratedData } from '../types/Attachment.std.ts';
import type { LinkPreviewWithHydratedData } from '../types/message/LinkPreviews.std.ts';
import { sniffImageMimeType } from '../util/sniffImageMimeType.std.ts';

// ADR-0063 §8.1 rows 2 and 10 ("测试发送工具"): a link preview of any shape, to be sent through the
// app's own send path, so that the receiving end of every platform can be tested with what a
// modified client could send (a lying level, a first-party look-alike, an oversized `RichContent`,
// a kind or provider that does not exist, a short link that changes provider). This module only
// turns a payload (plain JSON, so that it can come through a debugger) into the preview the send
// path takes; it does not check that what it builds is sensible: that is the point.

export type TestRichContentSpec = Readonly<{
  kind?: string | null;
  provider?: string | null;
  schema?: number | null;
  canonicalUrl?: string | null;
  attrs?: ReadonlyArray<Readonly<{ key: string; value: string }>> | null;
  level?: number | null;
  // Fields this build does not know, as a newer sender would add them: length-delimited, written
  // after the known ones, each `hex` being the payload of that field.
  unknownFields?: ReadonlyArray<
    Readonly<{ field: number; hex: string }>
  > | null;
}>;

export type TestLinkPreviewInput = Readonly<{
  url: string;
  title?: string | null;
  description?: string | null;
  // Milliseconds since the epoch.
  date?: number | null;
  // The picture of the preview. Its type is sniffed from the bytes unless `imageContentType` says;
  // its size in pixels is measured when the message is made unless `imageWidth` and `imageHeight`
  // say (they may lie: what a receiver sees is what the attachment says).
  imageBase64?: string;
  imageContentType?: string;
  imageWidth?: number;
  imageHeight?: number;
  // `Preview.rich` (field 1000), one of: built from the parts, or these bytes as they are. Given
  // neither, the preview has no `rich`.
  rich?: TestRichContentSpec;
  richHex?: string;
  richBase64?: string;
}>;

export type TestLinkPreviewPayload = Readonly<{
  body: string;
  preview: TestLinkPreviewInput;
}>;

export type BuiltTestLinkPreviewType = Readonly<{
  body: string;
  // As a message stores it: `rich` is the base64 of its bytes. No `width` / `height` / `blurHash` /
  // `plaintextHash` on the picture that the payload did not give: the caller measures them.
  preview: LinkPreviewWithHydratedData;
  // What `rich` is, as bytes; `undefined` without one.
  richBytes: Uint8Array<ArrayBuffer> | undefined;
}>;

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

// A field of wire type 2 (length-delimited), the way any encoder writes it.
export function encodeLengthDelimitedField(
  field: number,
  payload: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(field) || field < 1 || field > 0x1fffffff) {
    throw new RangeError(`not a field number: ${field}`);
  }
  // field << 3 | 2, without the 32-bit overflow of the shift.
  return Bytes.concatenate([
    varint(field * 8 + 2),
    varint(payload.byteLength),
    payload,
  ]);
}

function readHex(value: string, what: string): Uint8Array<ArrayBuffer> {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new TypeError(`${what} is not hex`);
  }
  return Bytes.fromHex(value);
}

function readBase64(value: string, what: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) {
    throw new TypeError(`${what} is not base64`);
  }
  return Bytes.fromBase64(value);
}

// `RichContent` from its parts. Known fields in field-number order, then the unknown ones: the
// bytes every encoder of this format produces, so they can be compared to what arrives.
export function buildTestRichBytes(
  spec: TestRichContentSpec
): Uint8Array<ArrayBuffer> {
  return Proto.RichContent.encode({
    kind: spec.kind ?? null,
    provider: spec.provider ?? null,
    schema: spec.schema ?? null,
    canonicalUrl: spec.canonicalUrl ?? null,
    attrs: spec.attrs?.length
      ? spec.attrs.map(({ key, value }) => ({ key, value }))
      : null,
    level: spec.level ?? null,
    $unknown: spec.unknownFields?.length
      ? spec.unknownFields.map(({ field, hex }) =>
          encodeLengthDelimitedField(
            field,
            readHex(hex, `unknown field ${field}`)
          )
        )
      : null,
  });
}

function getRichBytes(
  input: TestLinkPreviewInput
): Uint8Array<ArrayBuffer> | undefined {
  const given = [input.rich, input.richHex, input.richBase64].filter(
    value => value !== undefined
  );
  if (given.length > 1) {
    throw new TypeError('give at most one of rich, richHex and richBase64');
  }
  if (input.rich !== undefined) {
    return buildTestRichBytes(input.rich);
  }
  if (input.richHex !== undefined) {
    return readHex(input.richHex, 'richHex');
  }
  if (input.richBase64 !== undefined) {
    return readBase64(input.richBase64, 'richBase64');
  }
  return undefined;
}

function getImage(
  input: TestLinkPreviewInput
): AttachmentWithHydratedData | undefined {
  if (input.imageBase64 === undefined) {
    return undefined;
  }
  const data = readBase64(input.imageBase64, 'imageBase64');
  const contentType = input.imageContentType
    ? stringToMIMEType(input.imageContentType)
    : sniffImageMimeType(data);
  if (!contentType) {
    throw new TypeError(
      'the picture is not one of the image types; give imageContentType'
    );
  }
  return {
    contentType,
    data,
    size: data.byteLength,
    ...(input.imageWidth === undefined ? {} : { width: input.imageWidth }),
    ...(input.imageHeight === undefined ? {} : { height: input.imageHeight }),
  };
}

export function buildTestLinkPreview(
  payload: TestLinkPreviewPayload
): BuiltTestLinkPreviewType {
  if (typeof payload.body !== 'string') {
    throw new TypeError('body is a string');
  }
  const { preview: input } = payload;
  if (typeof input?.url !== 'string') {
    throw new TypeError('preview.url is a string');
  }

  const richBytes = getRichBytes(input);
  const image = getImage(input);

  return {
    body: payload.body,
    richBytes,
    preview: {
      url: input.url,
      ...(input.title == null ? {} : { title: input.title }),
      ...(input.description == null ? {} : { description: input.description }),
      ...(input.date == null ? {} : { date: input.date }),
      ...(richBytes ? { rich: Bytes.toBase64(richBytes) } : {}),
      ...(image ? { image } : {}),
    },
  };
}
