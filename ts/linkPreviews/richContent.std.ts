// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { SignalService as Proto } from '../protobuf/index.std.ts';
import * as Bytes from '../Bytes.std.ts';
import type { UploadedAttachmentType } from '../types/Attachment.std.ts';
import { createLogger } from '../logging/log.std.ts';

const log = createLogger('richContent');

// ADR-0063 §4.5 / §7.4: `Preview.rich` (field 1000) travels with the message as bytes. A received
// value is kept as it arrived — fields this build does not know included — base64 in the `rich`
// property of the message's stored `preview` JSON, and goes out again unchanged when the message
// is forwarded. It is never trimmed against the registry of the day; which card it becomes is
// decided at render time (§5.1).
//
// "As it arrived": protopiler keeps every field it does not know in `$unknown` and writes those
// back after the known ones, so re-encoding what it decoded gives back the received bytes for any
// encoder that writes fields in ascending order (prost, Wire, SwiftProtobuf and protopiler do).

export type RichContentBase64 = string;

export function richFromReceivedPreview(
  preview: Pick<Proto.Preview, 'rich'>
): RichContentBase64 | undefined {
  if (preview.rich == null) {
    return undefined;
  }
  return Bytes.toBase64(Proto.RichContent.encode(preview.rich));
}

// Absent → `null`, so a preview without `rich` encodes byte for byte as it did before the field
// existed. A stored value that no longer parses is dropped rather than failing the send: the
// snapshot (fields 1–5) always stands on its own (§7.1).
function richForOutgoingPreview(
  rich: RichContentBase64 | undefined
): Proto.RichContent | null {
  if (!rich) {
    return null;
  }
  try {
    return Proto.RichContent.decode(Bytes.fromBase64(rich));
  } catch {
    log.warn(`dropping unparsable rich content (${rich.length} base64 chars)`);
    return null;
  }
}

export type OutgoingPreviewForProto = Readonly<{
  title?: string;
  description?: string;
  url: string;
  image?: Readonly<UploadedAttachmentType>;
  date?: number;
  rich?: RichContentBase64;
}>;

// The upstream `DataMessage.preview` mapping from SendMessage, plus `rich`.
export function toOutgoingPreviewProto(
  preview: OutgoingPreviewForProto
): Proto.Preview.Params {
  return {
    title: preview.title ?? null,
    url: preview.url,
    description: preview.description ?? null,
    date: preview.date ? BigInt(preview.date) : null,
    image: preview.image ?? null,
    rich: richForOutgoingPreview(preview.rich),
  };
}
