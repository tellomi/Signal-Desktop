// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';

import * as Bytes from '../Bytes.std.ts';
import { isLinkIconFileName } from './linkCardIcon.std.ts';

// ADR-0063 §4.2 / §5.1 / §5.3: what rust/links' `classify` decided for one received preview.
// The JSON shape is `rust/links/src/classify.rs` `Card`; everything the sender wrote has already
// been re-checked against this device's registry and the URL in the message body.

export const localizedNameSchema = z.object({
  'zh-Hans': z.string(),
  'zh-Hant': z.string().optional(),
  en: z.string(),
});

const firstPartySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    display: z.string().nullable(),
    username: z.string().nullable(),
  }),
  z.object({
    type: z.literal('group'),
    title: z.string(),
    member_count: z.number().nullable(),
  }),
  z.object({ type: z.literal('call'), title: z.string().nullable() }),
  z.object({
    type: z.literal('sticker'),
    title: z.string(),
    sticker_count: z.number().nullable(),
  }),
  z.object({ type: z.literal('official'), path: z.string() }),
]);

// `Card.icon` (rust/links, brand level only): the file name of the icon that ships with the app.
// Absent from a native module that predates the field, null for a shell without an official icon.
// A name that is not an icon file name is treated as no icon rather than dropping the card.
const iconSchema = z
  .unknown()
  .transform((value): string | null =>
    isLinkIconFileName(value) ? value : null
  )
  .optional();

const linkCardSchema = z.object({
  level: z.enum([
    'plain_link',
    'generic',
    'brand',
    'structured',
    'first_party',
  ]),
  provider: z.string().nullable(),
  provider_name: localizedNameSchema.nullable(),
  kind: z.string().nullable(),
  route: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  attrs: z.array(z.object({ key: z.string(), value: z.string() })),
  domain: z.string().nullable(),
  official_badge: z.boolean(),
  first_party: firstPartySchema.nullable(),
  lookalike: z.string().nullable(),
  show_image: z.boolean(),
  icon: iconSchema,
  tintable: z.boolean(),
  payment: z.boolean(),
  reason: z.string().nullable(),
});

export type LinkCardType = ReadonlyDeep<z.infer<typeof linkCardSchema>>;
export type LinkCardLevel = LinkCardType['level'];
export type LinkCardLocalizedName = z.infer<typeof localizedNameSchema>;

export function parseLinkCard(json: string): LinkCardType | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const result = linkCardSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

// `rust/links` `ReceiveCheck` (ADR-0063 §7.4): what to do with a received preview before it is
// stored. `keep_preview` false drops the whole preview (the message itself is kept); `keep_preview`
// true with `keep_rich` false drops only `rich`, the snapshot stays.
const receiveCheckSchema = z.object({
  keep_preview: z.boolean(),
  keep_rich: z.boolean(),
});

export type ReceiveCheckType = z.infer<typeof receiveCheckSchema>;

export function parseReceiveCheck(json: string): ReceiveCheckType | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const result = receiveCheckSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

// What a received preview becomes before it is stored (ADR-0063 §5.1 rule 4, §7.4): rust/links'
// `receive_check`, and whether the card `classify` decides at that moment shows the preview's
// picture. A picture no card shows is not kept, so it is never downloaded (§7.4).
export type ReceivedLinkPreviewDecisionType = Readonly<{
  keepPreview: boolean;
  keepRich: boolean;
  keepImage: boolean;
}>;

export type LinkPreviewForClassify = Readonly<{
  url: string;
  title?: string;
  description?: string;
  hasImage: boolean;
  date?: number;
  // `Preview.rich` as Desktop stores it: base64 of the bytes as received.
  rich?: string;
}>;

// `rust/links` `PreviewInput`: the upstream fields 1–5 plus the raw bytes of field 1000 as hex.
export function toPreviewInputJson(preview: LinkPreviewForClassify): string {
  let rich: string | undefined;
  if (preview.rich) {
    try {
      rich = Bytes.toHex(Bytes.fromBase64(preview.rich));
    } catch {
      rich = undefined;
    }
  }
  return JSON.stringify({
    url: preview.url,
    title: preview.title || undefined,
    description: preview.description || undefined,
    has_image: preview.hasImage,
    date: preview.date && preview.date > 0 ? preview.date : undefined,
    rich,
  });
}

export type LinkMessageContext = Readonly<{
  isStory: boolean;
  attachmentContentTypes: ReadonlyArray<string>;
}>;

// `rust/links` `MessageContext`.
export function toMessageContextJson(context: LinkMessageContext): string {
  return JSON.stringify({
    is_story: context.isStory,
    attachment_content_types: context.attachmentContentTypes,
  });
}

// The registry names providers in zh-Hans, optionally zh-Hant, and en.
export function getLocalizedLinkName(
  name: LinkCardLocalizedName,
  locale: string
): string {
  const lower = locale.toLowerCase();
  if (lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh') {
    return name['zh-Hans'];
  }
  if (lower.startsWith('zh')) {
    return name['zh-Hant'] ?? name['zh-Hans'];
  }
  return name.en;
}
