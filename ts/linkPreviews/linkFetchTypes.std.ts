// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// What the link-preview fetcher is asked to do and what it reports (ADR-0063 §4.4). The fetcher
// itself is linkFetcher.node.ts; the job driver (linkSendJob.std.ts) only needs these shapes.

export type LinkFetchKind = 'fetch' | 'expand' | 'image';

export type LinkFetchRequest = Readonly<{
  kind: LinkFetchKind;
  url: string;
  userAgent: string;
  accept: string;
  // Lower-case MIME types the response may have; undefined for `expand` (the body is never read).
  contentTypes?: ReadonlyArray<string>;
  maxBytes: number;
  maxRedirects: number;
  connectTimeoutMs: number;
  timeoutMs: number;
}>;

export type LinkFetchFailure =
  | 'not_https'
  | 'not_allowed'
  | 'blocked_address'
  | 'redirect_limit'
  | 'content_type'
  | 'too_large'
  | 'encoding'
  | 'timeout'
  | 'aborted'
  | 'other';

export type LinkFetchResult =
  | Readonly<{
      type: 'response';
      status: number;
      finalUrl: string;
      contentType: string;
      location: string | null;
      body: Uint8Array<ArrayBuffer>;
      redirects: number;
    }>
  | Readonly<{ type: 'network_error' }>
  | Readonly<{ type: 'failure'; reason: LinkFetchFailure }>;
