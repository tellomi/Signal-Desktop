// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { lookup as dnsLookup } from 'node:dns/promises';
import type { Agent, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { drop } from '../util/drop.std.ts';
import { isBlockedLinkAddress } from './linkAddressPolicy.std.ts';
import type {
  LinkFetchFailure,
  LinkFetchRequest,
  LinkFetchResult,
} from './linkFetchTypes.std.ts';

// ADR-0063 §4.4 / §6.2: the one fetcher rust/links' requests go through on Desktop.
// - Headers are exactly User-Agent, Accept and Accept-Encoding (plus the Host HTTP/1.1 needs);
//   no cookies are kept or sent.
// - Redirects are followed by hand, at most `maxRedirects`; every hop is re-checked: https only,
//   `isAllowedUrl`, and the addresses DNS returned (checked in the lookup that the connection
//   itself uses, so there is no gap between checking and connecting).
// - Connect 5 s, whole request 10 s; the body is counted after decompression and the request is
//   dropped past `maxBytes`; the Content-Type must be one the step accepts.
// - Failures that happen before the TLS handshake completes (DNS, refused, reset, TLS) are
//   network errors: the host goes into the reachability memo (§4.3). Everything else is a failure.

export type LinkFetchEnv = Readonly<{
  // Every hop's URL must pass this too (Desktop: `shouldPreviewHref`).
  isAllowedUrl: (url: string) => boolean;
  // DNS; defaults to the system resolver (all addresses).
  resolve?: (host: string) => Promise<ReadonlyArray<string>>;
  // Tests only: where to really connect once an address has passed the check.
  connectAddress?: (address: string) => string;
  port?: number;
  ca?: string;
  // A user-configured proxy: the proxy resolves names, so addresses cannot be checked here.
  agent?: Agent;
  signal?: AbortSignal;
}>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BLOCKED_ADDRESS = 'TELLOMI_BLOCKED_ADDRESS';

class FetchFailure extends Error {
  readonly reason: LinkFetchFailure;

  constructor(reason: LinkFetchFailure) {
    super(reason);
    this.reason = reason;
  }
}

async function systemResolve(host: string): Promise<ReadonlyArray<string>> {
  const answers = await dnsLookup(host, { all: true, verbatim: true });
  return answers.map(({ address }) => address);
}

function mimeType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

type Hop =
  | Readonly<{
      kind: 'redirect';
      location: string;
      status: number;
      contentType: string;
    }>
  | Readonly<{
      kind: 'done';
      status: number;
      contentType: string;
      location: string | null;
      body: Uint8Array<ArrayBuffer>;
    }>;

function decoderFor(
  encoding: string | undefined
): ((source: IncomingMessage) => Readable) | undefined {
  switch ((encoding ?? 'identity').trim().toLowerCase()) {
    case 'identity':
    case '':
      return source => source;
    case 'gzip':
    case 'x-gzip':
      return source => source.pipe(createGunzip());
    case 'deflate':
      return source => source.pipe(createInflate());
    case 'br':
      return source => source.pipe(createBrotliDecompress());
    default:
      return undefined;
  }
}

function oneHop(
  url: URL,
  request: LinkFetchRequest,
  env: LinkFetchEnv,
  deadline: number,
  onConnected: () => void
): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const resolver = env.resolve ?? systemResolve;

    const lookup: LookupFunction = (hostname, options, callback) => {
      const answer = async (): Promise<void> => {
        let addresses: ReadonlyArray<string>;
        try {
          addresses = await resolver(hostname);
        } catch (error) {
          callback(error as NodeJS.ErrnoException, '');
          return;
        }
        if (addresses.length === 0) {
          callback(
            Object.assign(new Error('no address'), { code: 'ENOTFOUND' }),
            ''
          );
          return;
        }
        if (addresses.some(isBlockedLinkAddress)) {
          callback(
            Object.assign(new Error('blocked address'), {
              code: BLOCKED_ADDRESS,
            }),
            ''
          );
          return;
        }
        // Every answer passed the check; hand them all over so Node can fall back from a
        // broken IPv6 route to IPv4 (Happy Eyeballs), common on mainland networks.
        const answers = addresses.map(candidate => {
          const address = env.connectAddress
            ? env.connectAddress(candidate)
            : candidate;
          return { address, family: isIP(address) };
        });
        const first = answers[0];
        if (options.all) {
          callback(null, answers);
        } else if (first) {
          callback(null, first.address, first.family);
        }
      };
      drop(answer());
    };

    const req = httpsRequest({
      method: 'GET',
      host,
      port: env.port ?? (url.port ? Number(url.port) : 443),
      path: `${url.pathname}${url.search}`,
      servername: isIP(host) ? undefined : host,
      setDefaultHeaders: false,
      headers: {
        Host: url.host,
        'User-Agent': request.userAgent,
        Accept: request.accept,
        'Accept-Encoding': 'gzip, deflate, br',
      },
      agent: env.agent ?? false,
      ca: env.ca,
      // Node's default autoSelectFamily (Happy Eyeballs) tries the answers `lookup` returns.
      lookup: env.agent ? undefined : lookup,
    });

    let connected = false;
    const remaining = Math.max(1, deadline - Date.now());
    const totalTimer = setTimeout(() => {
      req.destroy(new FetchFailure('timeout'));
    }, remaining);
    const connectTimer = setTimeout(
      () => {
        if (!connected) {
          req.destroy(
            Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })
          );
        }
      },
      Math.min(request.connectTimeoutMs, remaining)
    );
    const onAbort = () => req.destroy(new FetchFailure('aborted'));
    env.signal?.addEventListener('abort', onAbort);
    const cleanup = () => {
      clearTimeout(totalTimer);
      clearTimeout(connectTimer);
      env.signal?.removeEventListener('abort', onAbort);
    };

    req.on('socket', socket => {
      socket.once('secureConnect', () => {
        connected = true;
        onConnected();
      });
    });

    req.on('error', error => {
      cleanup();
      reject(error);
    });

    req.on('response', response => {
      const status = response.statusCode ?? 0;
      const contentType = response.headers['content-type'] ?? '';
      const location = response.headers.location ?? null;

      if (request.kind === 'expand') {
        // Status and the first Location only; the body is never read (§4.4).
        response.destroy();
        cleanup();
        resolve({
          kind: 'done',
          status,
          contentType,
          location,
          body: new Uint8Array(0),
        });
        return;
      }

      if (REDIRECT_STATUSES.has(status) && location) {
        response.destroy();
        cleanup();
        resolve({ kind: 'redirect', location, status, contentType });
        return;
      }

      if (
        status >= 200 &&
        status < 300 &&
        request.contentTypes &&
        !request.contentTypes.includes(mimeType(contentType))
      ) {
        response.destroy();
        cleanup();
        reject(new FetchFailure('content_type'));
        return;
      }

      const decode = decoderFor(response.headers['content-encoding']);
      if (!decode) {
        response.destroy();
        cleanup();
        reject(new FetchFailure('encoding'));
        return;
      }

      const chunks: Array<Buffer<ArrayBuffer>> = [];
      let size = 0;
      const stream = decode(response);
      stream.on('data', (chunk: Buffer<ArrayBuffer>) => {
        size += chunk.byteLength;
        if (size > request.maxBytes) {
          response.destroy();
          stream.destroy(new FetchFailure('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', error => {
        cleanup();
        reject(
          error instanceof FetchFailure ? error : new FetchFailure('other')
        );
      });
      stream.on('end', () => {
        cleanup();
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({ kind: 'done', status, contentType, location, body });
      });
    });

    req.end();
  });
}

function classify(error: unknown, connected: boolean): LinkFetchResult {
  if (error instanceof FetchFailure) {
    return { type: 'failure', reason: error.reason };
  }
  const code = (error as { code?: string } | undefined)?.code;
  if (code === BLOCKED_ADDRESS) {
    return { type: 'failure', reason: 'blocked_address' };
  }
  // Nothing was exchanged with the site yet: DNS, TCP, TLS.
  if (!connected) {
    return { type: 'network_error' };
  }
  return { type: 'failure', reason: 'other' };
}

export async function performLinkFetch(
  request: LinkFetchRequest,
  env: LinkFetchEnv
): Promise<LinkFetchResult> {
  const deadline = Date.now() + request.timeoutMs;
  let current: URL;
  try {
    current = new URL(request.url);
  } catch {
    return { type: 'failure', reason: 'other' };
  }

  for (let redirects = 0; ; redirects += 1) {
    if (current.protocol !== 'https:') {
      return { type: 'failure', reason: 'not_https' };
    }
    if (!env.isAllowedUrl(current.href)) {
      return { type: 'failure', reason: 'not_allowed' };
    }
    const host = current.hostname.replace(/^\[|\]$/g, '');
    // An IP literal never goes through DNS: check it here.
    if (isIP(host) && isBlockedLinkAddress(host)) {
      return { type: 'failure', reason: 'blocked_address' };
    }

    let connected = false;
    let hop: Hop;
    try {
      // eslint-disable-next-line no-await-in-loop
      hop = await oneHop(current, request, env, deadline, () => {
        connected = true;
      });
    } catch (error) {
      return classify(error, connected);
    }

    if (hop.kind === 'done') {
      return {
        type: 'response',
        status: hop.status,
        finalUrl: current.href,
        contentType: hop.contentType,
        location: hop.location,
        body: hop.body,
        redirects,
      };
    }

    if (redirects >= request.maxRedirects) {
      return { type: 'failure', reason: 'redirect_limit' };
    }
    try {
      current = new URL(hop.location, current);
    } catch {
      return { type: 'failure', reason: 'other' };
    }
  }
}
