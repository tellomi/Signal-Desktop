// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';

import * as Bytes from '../Bytes.std.ts';
import type {
  LinkFetchRequest,
  LinkFetchResult,
} from './linkFetchTypes.std.ts';

// ADR-0063 §4.2 / §4.4 / §5.2, sender side: rust/links decides what to fetch, the client fetches
// it and feeds the result back, rust/links assembles the preview. This drives one link's job:
// begin → next request → perform → feed back → … → finish, within the 10 s budget per link.

// The parts of libsignal-client's `LinkJob` this uses.
export type LinkJobLike = {
  nextRequest(): string | null;
  onResponse(
    id: number,
    status: number,
    finalUrl: string,
    contentType: string,
    location: string | null,
    body: Uint8Array<ArrayBuffer>
  ): void;
  onNetworkError(id: number): void;
  onFailure(id: number): void;
  onFirstParty(id: number, result: string): void;
  onImage(id: number, ok: boolean): void;
  finish(): string;
};

const requestSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.number(),
    type: z.literal('expand_short_link'),
    url: z.string(),
    user_agent: z.string(),
    connect_timeout_ms: z.number(),
    timeout_ms: z.number(),
  }),
  z.object({
    id: z.number(),
    type: z.literal('fetch'),
    url: z.string(),
    user_agent: z.string(),
    accept: z.string(),
    content_types: z.array(z.string()),
    max_bytes: z.number(),
    max_redirects: z.number(),
    connect_timeout_ms: z.number(),
    timeout_ms: z.number(),
  }),
  z.object({
    id: z.number(),
    type: z.literal('first_party'),
    kind: z.string(),
  }),
  z.object({
    id: z.number(),
    type: z.literal('image'),
    url: z.string(),
    user_agent: z.string(),
    max_redirects: z.number(),
    connect_timeout_ms: z.number(),
    timeout_ms: z.number(),
  }),
]);

const outcomeSchema = z.object({
  level: z.enum([
    'plain_link',
    'generic',
    'brand',
    'structured',
    'first_party',
  ]),
  provider: z.string().nullable(),
  route: z.string().nullable(),
  kind: z.string().nullable(),
  preview: z
    .object({
      url: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      image_url: z.string().nullable(),
      date: z.number().nullable(),
      rich_hex: z.string().nullable(),
    })
    .nullable(),
  group_link_invalid: z.boolean(),
  lookalike: z.string().nullable(),
  newly_unreachable_hosts: z.array(z.string()),
  failures: z.array(z.string()),
});

export type LinkSendOutcome = ReadonlyDeep<z.infer<typeof outcomeSchema>>;

export function parseLinkSendOutcome(
  json: string
): LinkSendOutcome | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const result = outcomeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

// What the client found for a tell.cc object with its own existing lookup (group join info,
// call link room, sticker manifest). `invalid`: the group link is definitely not active.
export type LinkFirstPartyResult = Readonly<{
  ok: boolean;
  invalid?: boolean;
  title?: string;
  member_count?: number;
  sticker_count?: number;
}>;

export type LinkSendContext = Readonly<{
  unreachableHosts: ReadonlyArray<string>;
  expandShortLinks: boolean;
  locale: string;
}>;

export type LinkSendDeps = Readonly<{
  begin: (url: string, contextJson: string) => LinkJobLike;
  fetch: (request: LinkFetchRequest) => Promise<LinkFetchResult>;
  firstParty: (kind: string) => Promise<LinkFirstPartyResult>;
  // Validate and re-encode the preview image the way Signal does; false if it is not usable.
  acceptImage: (
    body: Uint8Array<ArrayBuffer>,
    contentType: string
  ) => Promise<boolean>;
  now: () => number;
  // Called with every request as rust/links issued it (tests compare it with the golden).
  onRequest?: (json: string) => void;
}>;

export const LINK_BUDGET_MS = 10_000;

// Desktop keeps its current image limits (§4.4: "images keep each platform's values").
const LINK_IMAGE_MAX_BYTES = 1024 * 1024;
const LINK_IMAGE_CONTENT_TYPES: ReadonlyArray<string> = [
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
  'image/png',
  'image/webp',
];

function feed(job: LinkJobLike, id: number, result: LinkFetchResult): void {
  switch (result.type) {
    case 'response':
      job.onResponse(
        id,
        result.status,
        result.finalUrl,
        result.contentType,
        result.location,
        result.body
      );
      return;
    case 'network_error':
      job.onNetworkError(id);
      return;
    case 'failure':
      job.onFailure(id);
      return;
    default: {
      const unexpected: never = result;
      throw new Error(`unexpected fetch result ${JSON.stringify(unexpected)}`);
    }
  }
}

// `undefined`: aborted, or rust/links answered something this build does not understand.
export async function runLinkSendJob(
  url: string,
  context: LinkSendContext,
  deps: LinkSendDeps,
  signal?: AbortSignal
): Promise<LinkSendOutcome | undefined> {
  const job = deps.begin(
    url,
    JSON.stringify({
      region: 'global', // P1: RegionProfile is not wired on Desktop yet (§4.3).
      unreachable_hosts: context.unreachableHosts,
      expand_short_links: context.expandShortLinks,
      locale: context.locale,
    })
  );
  const deadline = deps.now() + LINK_BUDGET_MS;

  for (;;) {
    if (signal?.aborted) {
      return undefined;
    }
    const remaining = deadline - deps.now();
    if (remaining <= 0) {
      break; // Budget spent: settle for what is already known (§5.2).
    }
    const json = job.nextRequest();
    if (json == null) {
      break;
    }
    deps.onRequest?.(json);
    const parsed = requestSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      return undefined;
    }
    const request = parsed.data;
    switch (request.type) {
      case 'expand_short_link':
        feed(
          job,
          request.id,
          // eslint-disable-next-line no-await-in-loop
          await deps.fetch({
            kind: 'expand',
            url: request.url,
            userAgent: request.user_agent,
            accept: '*/*',
            maxBytes: 0,
            maxRedirects: 0,
            connectTimeoutMs: request.connect_timeout_ms,
            timeoutMs: Math.min(request.timeout_ms, remaining),
          })
        );
        break;
      case 'fetch':
        feed(
          job,
          request.id,
          // eslint-disable-next-line no-await-in-loop
          await deps.fetch({
            kind: 'fetch',
            url: request.url,
            userAgent: request.user_agent,
            accept: request.accept,
            contentTypes: request.content_types,
            maxBytes: request.max_bytes,
            maxRedirects: request.max_redirects,
            connectTimeoutMs: request.connect_timeout_ms,
            timeoutMs: Math.min(request.timeout_ms, remaining),
          })
        );
        break;
      case 'first_party': {
        // eslint-disable-next-line no-await-in-loop
        const result = await deps.firstParty(request.kind);
        job.onFirstParty(request.id, JSON.stringify(result));
        break;
      }
      case 'image': {
        // eslint-disable-next-line no-await-in-loop
        const result = await deps.fetch({
          kind: 'image',
          url: request.url,
          userAgent: request.user_agent,
          accept: 'image/*',
          contentTypes: LINK_IMAGE_CONTENT_TYPES,
          maxBytes: LINK_IMAGE_MAX_BYTES,
          maxRedirects: request.max_redirects,
          connectTimeoutMs: request.connect_timeout_ms,
          timeoutMs: Math.min(request.timeout_ms, remaining),
        });
        const ok =
          result.type === 'response' &&
          result.status >= 200 &&
          result.status < 300 &&
          // eslint-disable-next-line no-await-in-loop
          (await deps.acceptImage(result.body, result.contentType));
        job.onImage(request.id, ok);
        break;
      }
      default: {
        const unexpected: never = request;
        throw new Error(`unexpected request ${JSON.stringify(unexpected)}`);
      }
    }
  }

  if (signal?.aborted) {
    return undefined;
  }
  return parseLinkSendOutcome(job.finish());
}

// The outcome's preview in Desktop's shape: `Preview.rich` travels as base64 of the bytes
// rust/links encoded (hex over the bridge). `image` is the client's own: the processed download
// for `image_url`, or a tell.cc object's avatar / cover from the existing lookups.
export function toLinkPreviewResult<Image>(
  preview: NonNullable<LinkSendOutcome['preview']>,
  image: Image | undefined
): Readonly<{
  url: string;
  title: string | null;
  description: string | null;
  date: number | null;
  image?: Image;
  rich?: string;
}> {
  return {
    url: preview.url,
    title: preview.title,
    description: preview.description,
    date: preview.date,
    image,
    rich: preview.rich_hex
      ? Bytes.toBase64(Bytes.fromHex(preview.rich_hex))
      : undefined,
  };
}
