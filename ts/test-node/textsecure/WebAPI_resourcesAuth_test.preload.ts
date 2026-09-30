// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import sinon from 'sinon';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { Response } from 'node-fetch';

import * as WebAPI from '../../textsecure/WebAPI.preload.ts';
import { updateRemoteConfig } from '../../test-helpers/RemoteConfigStub.dom.ts';
import { SocketManager } from '../../textsecure/SocketManager.preload.ts';

// Tellomi（tellomi/tellomi ADR-0073 §3.12）：`resources` 主机（updates.tellomi.app）是 Cloudflare 边缘后面的公开
// 静态资源，不需要账号；上游会把 `Authorization: Basic <aci.deviceId:password>` 一起发过去，这里必须不发。
// 聊天服务（走 websocket）则相反：`SocketManager.fetch` 靠这个头选「已登录」通道，必须还在。
//
// 不起真实的 TLS：把 `https.request`（node-fetch 每次请求现取）转到本机一个明文 HTTP 服务上，
// 服务端记下的就是 node-fetch 实际交给网络层的请求头。
//
// WebAPI 在文件顶部静态导入，是因为它会往全局挂 tslib 的东西，放进用例里动态导入会被 mocha 的泄漏检查判失败。

const USERNAME = 'ab12cd34-0000-4000-8000-000000000000.2';
const PASSWORD = 'correct-horse-battery-staple';
const BASIC_CREDENTIALS = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;

type CapturedRequest = Readonly<{
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
}>;

describe('WebAPI credentials', () => {
  // `connect()` stubs, for the whole suite
  const suiteSandbox = sinon.createSandbox();
  // network stubs, per test
  let sandbox: sinon.SinonSandbox;

  let server: http.Server;
  let serverPort: number;
  let captured: Array<CapturedRequest>;
  let chatRequests: Array<{ url: string; authorization: unknown }>;

  before(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '';
      captured.push({
        method: req.method ?? '',
        path,
        headers: req.headers,
      });

      if (req.method === 'HEAD') {
        res.writeHead(200, { ETag: '"tellomi-test"' });
        res.end();
        return;
      }

      if (path.endsWith('release-notes-v2.json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ announcements: [], megaphones: [] }));
      } else if (path.endsWith('manifest.json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '1', languages: { en: ['a'] } }));
      } else if (path.endsWith('.json')) {
        // Valid for both `releaseNoteSchema` and `megaphoneSchema`
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ uuid: 'note-1', title: 't', body: 'b' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from([1, 2, 3]));
      }
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    serverPort = (server.address() as AddressInfo).port;

    // `connect()` binds remote config to libsignal, reads the version, and would open a real
    // chat websocket
    await updateRemoteConfig([]);
    window.getVersion = () => '1.0.0';
    suiteSandbox.stub(SocketManager.prototype, 'authenticate').resolves();
    suiteSandbox
      .stub(SocketManager.prototype, 'onHasStoriesDisabledChange')
      .resolves();
    await WebAPI.connect({
      username: USERNAME,
      password: PASSWORD,
      hasStoriesDisabled: false,
      hasBuildExpired: false,
    });
  });

  after(async () => {
    suiteSandbox.restore();
    delete (window as { getVersion?: unknown }).getVersion;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    captured = [];
    chatRequests = [];

    // node-fetch picks `https.request` at call time; aim it at the local server.
    sandbox.stub(https, 'request').callsFake(((
      url: string,
      options: https.RequestOptions
    ) => {
      const target = new URL(url);
      target.protocol = 'http:';
      target.hostname = '127.0.0.1';
      target.port = String(serverPort);
      return http.request(target, {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
      });
    }) as unknown as typeof https.request);

    sandbox
      .stub(SocketManager.prototype, 'fetch')
      .callsFake(async (url, init) => {
        chatRequests.push({
          url,
          authorization: (init.headers as Record<string, unknown> | undefined)
            ?.Authorization,
        });
        return Response.json(
          { username: 'storage-user', password: 'storage-pass' },
          { status: 200 }
        );
      });
  });

  afterEach(() => {
    sandbox.restore();
  });

  function assertNoCredentialsOnTheWire(): void {
    assert.isAbove(
      captured.length,
      0,
      'expected a request to reach the server'
    );
    for (const { method, path, headers } of captured) {
      const label = `${method} ${path}`;
      assert.notProperty(headers, 'authorization', label);
      const everything = JSON.stringify(headers);
      assert.notInclude(everything, PASSWORD, label);
      assert.notInclude(everything, USERNAME, label);
    }
  }

  describe('resources host (updates.tellomi.app)', () => {
    it('getOnboardingStoryManifest carries no credentials', async () => {
      await WebAPI.getOnboardingStoryManifest();
      assertNoCredentialsOnTheWire();
    });

    it('getReleaseNotesManifest carries no credentials', async () => {
      await WebAPI.getReleaseNotesManifest();
      assertNoCredentialsOnTheWire();
    });

    it('getReleaseNotesManifestHash carries no credentials', async () => {
      assert.strictEqual(
        await WebAPI.getReleaseNotesManifestHash(),
        '"tellomi-test"'
      );
      assertNoCredentialsOnTheWire();
    });

    it('getReleaseNote carries no credentials', async () => {
      await WebAPI.getReleaseNote({ uuid: 'note-1', locale: 'en' });
      assertNoCredentialsOnTheWire();
    });

    it('getReleaseNoteHash carries no credentials', async () => {
      await WebAPI.getReleaseNoteHash({ uuid: 'note-1', locale: 'en' });
      assertNoCredentialsOnTheWire();
    });

    it('getMegaphone carries no credentials', async () => {
      await WebAPI.getMegaphone({ uuid: 'note-1', locale: 'en' });
      assertNoCredentialsOnTheWire();
    });

    // These three do not go through `_ajax`; pinned here so the whole host stays covered.
    it('getReleaseNoteImageAttachment carries no credentials', async () => {
      await WebAPI.getReleaseNoteImageAttachment('/static/release-notes/a.png');
      assertNoCredentialsOnTheWire();
    });

    it('downloadOnboardingStories carries no credentials', async () => {
      await WebAPI.downloadOnboardingStories('1', ['a', 'b']);
      assertNoCredentialsOnTheWire();
    });

    it('getBadgeImageFile carries no credentials', async () => {
      // `updatesUrl` in test-node's setup is https://127.0.0.1:9
      await WebAPI.getBadgeImageFile('https://127.0.0.1:9/static/badges/a.png');
      assertNoCredentialsOnTheWire();
    });

    it('never used the chat socket', async () => {
      await WebAPI.getReleaseNotesManifest();
      assert.deepEqual(chatRequests, []);
    });
  });

  describe('chat service', () => {
    it('still sends the account credentials', async () => {
      await WebAPI.getStorageCredentials();

      assert.lengthOf(chatRequests, 1);
      assert.strictEqual(chatRequests[0]?.authorization, BASIC_CREDENTIALS);
      assert.lengthOf(
        captured,
        0,
        'chat calls must not touch the resources server'
      );
    });
  });
});
