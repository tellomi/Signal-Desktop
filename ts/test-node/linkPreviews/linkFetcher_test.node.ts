// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assert } from 'chai';

import type { LinkFetchEnv } from '../../linkPreviews/linkFetcher.node.ts';
import type { LinkFetchRequest } from '../../linkPreviews/linkFetchTypes.std.ts';
import { performLinkFetch } from '../../linkPreviews/linkFetcher.node.ts';

// ADR-0063 §4.4 / §6.2 (tellomi/tellomi#1421): the Desktop fetcher against an offline fixture —
// a local https server with a throwaway certificate for *.fetch-fixture.test, a fake DNS, and
// every checked address re-pointed at the local server. The fetcher keeps blocking 127/8 exactly
// as in production; only the connection, after the check, goes to localhost.

const DNS: Record<string, ReadonlyArray<string>> = {
  'private.fetch-fixture.test': ['10.0.0.5'],
  'mixed.fetch-fixture.test': ['203.0.113.9', '10.0.0.1'],
  'fakeip.fetch-fixture.test': ['198.18.0.5'],
  'v6local.fetch-fixture.test': ['fd00::2'],
  // A broken IPv6 answer first, a working IPv4 one after (common on mainland networks).
  'dual.fetch-fixture.test': ['2001:db8::1', '203.0.113.50'],
};
for (let i = 0; i <= 8; i += 1) {
  DNS[`h${i}.fetch-fixture.test`] = [`203.0.113.${10 + i}`];
}

type Seen = Readonly<{
  host: string;
  path: string;
  headers: IncomingMessage['headers'];
  rawHeaderNames: ReadonlyArray<string>;
}>;

const HTML = '<html><head><title>fixture</title></head><body>ok</body></html>';

describe('performLinkFetch', function (this: Mocha.Suite) {
  this.timeout(20000);

  let dir: string;
  let cert: string;
  let server: Server;
  let port: number;
  let seen: Array<Seen>;
  let resolved: Array<string>;

  function route(req: IncomingMessage, res: ServerResponse): void {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    const path = req.url ?? '/';
    seen.push({
      host,
      path,
      headers: req.headers,
      rawHeaderNames: req.rawHeaders
        .filter((_, index) => index % 2 === 0)
        .map(name => name.toLowerCase()),
    });

    const hop = /^\/hop\/(\d+)\/(\d+)$/.exec(path);
    if (hop) {
      const at = Number(hop[1]);
      const total = Number(hop[2]);
      if (at < total) {
        res.writeHead(302, {
          Location: `https://h${at + 1}.fetch-fixture.test/hop/${at + 1}/${total}`,
        });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
      }
      return;
    }

    switch (path) {
      case '/page':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
      case '/cookie-redirect':
        res.writeHead(302, {
          'Set-Cookie': 'track=1; Path=/',
          Location: '/cookie-final',
        });
        res.end();
        return;
      case '/cookie-final':
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'track=2; Path=/',
        });
        res.end(HTML);
        return;
      case '/to-private':
        res.writeHead(302, {
          Location: 'https://private.fetch-fixture.test/page',
        });
        res.end();
        return;
      case '/to-mixed':
        res.writeHead(302, {
          Location: 'https://mixed.fetch-fixture.test/page',
        });
        res.end();
        return;
      case '/to-v6local':
        res.writeHead(302, {
          Location: 'https://v6local.fetch-fixture.test/page',
        });
        res.end();
        return;
      case '/to-http':
        res.writeHead(302, { Location: 'http://h1.fetch-fixture.test/page' });
        res.end();
        return;
      case '/json':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"a":1}');
        return;
      case '/gzip':
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Encoding': 'gzip',
        });
        res.end(gzipSync(HTML));
        return;
      case '/bomb':
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Encoding': 'gzip',
        });
        res.end(gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x20)));
        return;
      case '/weird-encoding':
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Encoding': 'compress',
        });
        res.end(HTML);
        return;
      case '/short':
        res.writeHead(301, {
          Location: 'https://h2.fetch-fixture.test/page',
          'Content-Type': 'text/html',
        });
        res.end(Buffer.alloc(512 * 1024, 0x20));
        return;
      case '/hang':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<html>');
        return;
      case '/unavailable':
        res.writeHead(503, { 'Retry-After': '0', 'Content-Type': 'text/html' });
        res.end(HTML);
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tellomi-fetch-fixture-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=fetch-fixture.test',
        '-addext',
        'subjectAltName=DNS:*.fetch-fixture.test',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' }
    );
    cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
    server = createServer(
      { key: readFileSync(join(dir, 'key.pem')), cert },
      route
    );
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    seen = [];
    resolved = [];
  });

  function env(overrides: Partial<LinkFetchEnv> = {}): LinkFetchEnv {
    return {
      isAllowedUrl: () => true,
      resolve: async host => {
        resolved.push(host);
        const answers = DNS[host];
        if (!answers) {
          throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
        }
        return answers;
      },
      connectAddress: () => '127.0.0.1',
      port,
      ca: cert,
      ...overrides,
    };
  }

  function page(url: string, overrides: Partial<LinkFetchRequest> = {}) {
    return {
      kind: 'fetch' as const,
      url,
      userAgent: 'WhatsApp/2',
      accept: 'text/html',
      contentTypes: ['text/html', 'application/xhtml+xml'],
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 5,
      connectTimeoutMs: 5000,
      timeoutMs: 10000,
      ...overrides,
    };
  }

  it('sends only User-Agent WhatsApp/2, Accept, Accept-Encoding (and Host)', async () => {
    const result = await performLinkFetch(
      page('https://h1.fetch-fixture.test/page'),
      env()
    );
    assert.strictEqual(result.type, 'response');
    assert.strictEqual(seen.length, 1);
    assert.sameMembers(
      [...(seen[0]?.rawHeaderNames ?? [])],
      ['host', 'user-agent', 'accept', 'accept-encoding']
    );
    assert.strictEqual(seen[0]?.headers['user-agent'], 'WhatsApp/2');
    assert.strictEqual(
      result.type === 'response' && Buffer.from(result.body).toString(),
      HTML
    );
  });

  it('neither keeps nor sends a cookie set on a redirect', async () => {
    await performLinkFetch(
      page('https://h1.fetch-fixture.test/cookie-redirect'),
      env()
    );
    await performLinkFetch(
      page('https://h1.fetch-fixture.test/cookie-redirect'),
      env()
    );
    assert.strictEqual(seen.length, 4);
    for (const request of seen) {
      assert.isUndefined(request.headers.cookie);
    }
  });

  it('follows five redirects across hosts, checking every hop', async () => {
    const result = await performLinkFetch(
      page('https://h0.fetch-fixture.test/hop/0/5'),
      env()
    );
    assert.strictEqual(result.type, 'response');
    assert.strictEqual(
      result.type === 'response' && result.finalUrl,
      'https://h5.fetch-fixture.test/hop/5/5'
    );
    assert.strictEqual(result.type === 'response' && result.redirects, 5);
    assert.deepEqual(resolved, [
      'h0.fetch-fixture.test',
      'h1.fetch-fixture.test',
      'h2.fetch-fixture.test',
      'h3.fetch-fixture.test',
      'h4.fetch-fixture.test',
      'h5.fetch-fixture.test',
    ]);
  });

  it('does not follow a sixth redirect', async () => {
    const result = await performLinkFetch(
      page('https://h0.fetch-fixture.test/hop/0/7'),
      env()
    );
    assert.deepEqual(result, { type: 'failure', reason: 'redirect_limit' });
    assert.strictEqual(seen.length, 6);
  });

  it('does not connect to a redirect target that resolves to a private address', async () => {
    for (const path of ['/to-private', '/to-mixed', '/to-v6local']) {
      seen = [];
      // eslint-disable-next-line no-await-in-loop
      const result = await performLinkFetch(
        page(`https://h1.fetch-fixture.test${path}`),
        env()
      );
      assert.deepEqual(
        result,
        { type: 'failure', reason: 'blocked_address' },
        path
      );
      assert.deepEqual(
        seen.map(({ path: seenPath }) => seenPath),
        [path],
        path
      );
    }
  });

  it('refuses a private IP literal without touching DNS', async () => {
    for (const url of [
      'https://127.0.0.1/page',
      'https://10.0.0.1/page',
      'https://100.64.1.1/page',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:192.168.0.1]/page',
      'https://[fd00::2]/page',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await performLinkFetch(page(url), env());
      assert.deepEqual(
        result,
        { type: 'failure', reason: 'blocked_address' },
        url
      );
    }
    assert.deepEqual(resolved, []);
    assert.deepEqual(seen, []);
  });

  it('falls back to IPv4 when the IPv6 answer does not connect', async () => {
    const result = await performLinkFetch(
      page('https://dual.fetch-fixture.test/page'),
      // Nothing listens on ::1: the IPv6 attempt is refused, the IPv4 one reaches the fixture.
      env({
        connectAddress: address => (isIPv6(address) ? '::1' : '127.0.0.1'),
      })
    );
    assert.strictEqual(result.type, 'response');
    assert.strictEqual(seen.length, 1);
  });

  it('allows the fake-ip proxy range 198.18/15', async () => {
    const result = await performLinkFetch(
      page('https://fakeip.fetch-fixture.test/page'),
      env()
    );
    assert.strictEqual(result.type, 'response');
  });

  it('does not follow a redirect to http, and never starts from http', async () => {
    assert.deepEqual(
      await performLinkFetch(
        page('https://h1.fetch-fixture.test/to-http'),
        env()
      ),
      { type: 'failure', reason: 'not_https' }
    );
    resolved = [];
    seen = [];
    assert.deepEqual(
      await performLinkFetch(page('http://h1.fetch-fixture.test/page'), env()),
      { type: 'failure', reason: 'not_https' }
    );
    assert.deepEqual(resolved, []);
    assert.deepEqual(seen, []);
  });

  it('re-checks every hop against the preview URL rules', async () => {
    const result = await performLinkFetch(
      page('https://h0.fetch-fixture.test/hop/0/3'),
      env({ isAllowedUrl: url => !url.includes('h2.') })
    );
    assert.deepEqual(result, { type: 'failure', reason: 'not_allowed' });
    assert.strictEqual(seen.length, 2);
  });

  it('only accepts the content types the step asked for', async () => {
    assert.deepEqual(
      await performLinkFetch(page('https://h1.fetch-fixture.test/json'), env()),
      { type: 'failure', reason: 'content_type' }
    );
    const json = await performLinkFetch(
      page('https://h1.fetch-fixture.test/json', {
        accept: 'application/json',
        contentTypes: ['application/json'],
      }),
      env()
    );
    assert.strictEqual(json.type, 'response');
  });

  it('decompresses, and counts the limit after decompression', async () => {
    const gzip = await performLinkFetch(
      page('https://h1.fetch-fixture.test/gzip'),
      env()
    );
    assert.strictEqual(
      gzip.type === 'response' && Buffer.from(gzip.body).toString(),
      HTML
    );
    assert.deepEqual(
      await performLinkFetch(page('https://h1.fetch-fixture.test/bomb'), env()),
      { type: 'failure', reason: 'too_large' }
    );
    assert.deepEqual(
      await performLinkFetch(
        page('https://h1.fetch-fixture.test/weird-encoding'),
        env()
      ),
      { type: 'failure', reason: 'encoding' }
    );
  });

  it('expands a short link from the Location header without following it', async () => {
    const result = await performLinkFetch(
      page('https://h1.fetch-fixture.test/short', {
        kind: 'expand',
        accept: '*/*',
        contentTypes: undefined,
        maxBytes: 0,
        maxRedirects: 0,
      }),
      env()
    );
    assert.strictEqual(result.type, 'response');
    assert.strictEqual(result.type === 'response' && result.status, 301);
    assert.strictEqual(
      result.type === 'response' && result.location,
      'https://h2.fetch-fixture.test/page'
    );
    assert.strictEqual(result.type === 'response' && result.body.length, 0);
    assert.strictEqual(seen.length, 1);
  });

  it('reports a DNS failure as a network error', async () => {
    assert.deepEqual(
      await performLinkFetch(
        page('https://nowhere.fetch-fixture.test/'),
        env()
      ),
      { type: 'network_error' }
    );
  });

  it('gives up on a response that never finishes', async () => {
    const started = Date.now();
    const result = await performLinkFetch(
      page('https://h1.fetch-fixture.test/hang', { timeoutMs: 700 }),
      env()
    );
    assert.deepEqual(result, { type: 'failure', reason: 'timeout' });
    assert.isBelow(Date.now() - started, 3000);
  });

  it('does not retry a 503', async () => {
    const result = await performLinkFetch(
      page('https://h1.fetch-fixture.test/unavailable'),
      env()
    );
    assert.strictEqual(result.type === 'response' && result.status, 503);
    assert.strictEqual(seen.length, 1);
  });
});
