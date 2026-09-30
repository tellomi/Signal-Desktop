// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LinkRegistryDeps } from '../../linkPreviews/linkRegistryStore.node.ts';
import {
  checkForLinkRegistryUpdate,
  loadBestLinkRegistry,
  parseLinkRegistryPointer,
  saveLinkRegistryUpdate,
} from '../../linkPreviews/linkRegistryStore.node.ts';

// ADR-0063 §4.7 / §6.4 / §7.3, §8.1 rows 2–3 (tellomi/tellomi#1421): Desktop takes a hot-updated link registry only
// when it is signed, newer, in the schema range and passes the content rules (rust/links checks all of that in
// `loadUpdate`); anything else keeps the bundled one. The native calls are faked here (no native library off macOS).

type FakeRegistry = { version: bigint; from: 'bundled' | 'update' };

const encoder = new TextEncoder();
const publicKey = new Uint8Array(33).fill(5);
const bytes = (text: string) => encoder.encode(text);
const sha256 = (data: Uint8Array<ArrayBuffer>) =>
  createHash('sha256').update(data).digest('hex');

// An update envelope is `v<version>[:bad-signature|:old|:schema|:rules]`; signature file text is `aa` or `bb` (hex).
function makeDeps(
  bundledVersion = 2026092702n
): LinkRegistryDeps<FakeRegistry> & { calls: Array<string> } {
  const calls: Array<string> = [];
  return {
    calls,
    load() {
      return { version: bundledVersion, from: 'bundled' };
    },
    loadUpdate(envelope, signatureHex, key, currentVersion) {
      const text = new TextDecoder().decode(envelope);
      calls.push(text);
      assert.deepEqual(key, publicKey);
      if (signatureHex !== 'aa') {
        throw new Error('signature');
      }
      const version = BigInt(text.split(':')[0].slice(1));
      if (text.endsWith(':schema')) {
        throw new Error('schema');
      }
      if (text.endsWith(':rules')) {
        throw new Error('rules');
      }
      if (currentVersion != null && version <= currentVersion) {
        throw new Error('not newer');
      }
      return { version, from: 'update' };
    },
  };
}

describe('link registry hot update', () => {
  let dir: string;
  let bundledPath: string;
  let updateDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'link-registry-'));
    bundledPath = join(dir, 'bundled.json');
    updateDir = join(dir, 'updates');
    writeFileSync(bundledPath, 'bundled');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const load = (deps = makeDeps()) =>
    loadBestLinkRegistry({ bundledPath, updateDir, publicKey, deps });

  describe('loadBestLinkRegistry', () => {
    it('uses the bundled registry when nothing was downloaded', () => {
      const { registry, source } = load();
      assert.strictEqual(source, 'bundled');
      assert.strictEqual(registry.version, 2026092702n);
    });

    it('uses a downloaded newer one', () => {
      saveLinkRegistryUpdate(updateDir, 2026093001, bytes('v2026093001'), 'aa');
      const { registry, source } = load();
      assert.strictEqual(source, 'update');
      assert.strictEqual(registry.version, 2026093001n);
    });

    it('asks loadUpdate with the bundled version as the version in use', () => {
      saveLinkRegistryUpdate(updateDir, 2026092702, bytes('v2026092702'), 'aa');
      const { source } = load();
      assert.strictEqual(source, 'bundled', 'not strictly newer');
    });

    it('a bad signature keeps the bundled one and drops the file', () => {
      saveLinkRegistryUpdate(updateDir, 2026093001, bytes('v2026093001'), 'bb');
      assert.strictEqual(load().source, 'bundled');
      assert.deepEqual(readdirSync(updateDir), []);
    });

    it('an older version keeps the bundled one', () => {
      saveLinkRegistryUpdate(updateDir, 2026092601, bytes('v2026092601'), 'aa');
      assert.strictEqual(load().source, 'bundled');
    });

    it('a schema this build does not read keeps the bundled one', () => {
      saveLinkRegistryUpdate(
        updateDir,
        2026093001,
        bytes('v2026093001:schema'),
        'aa'
      );
      assert.strictEqual(load().source, 'bundled');
    });

    it('a content rule that fails keeps the bundled one', () => {
      saveLinkRegistryUpdate(
        updateDir,
        2026093001,
        bytes('v2026093001:rules'),
        'aa'
      );
      assert.strictEqual(load().source, 'bundled');
    });

    it('takes the newest that passes, falling back to an older one that does', () => {
      saveLinkRegistryUpdate(updateDir, 2026093001, bytes('v2026093001'), 'aa');
      saveLinkRegistryUpdate(
        updateDir,
        2026093002,
        bytes('v2026093002:rules'),
        'aa'
      );
      const { registry } = load();
      assert.strictEqual(registry.version, 2026093001n);
    });

    it('ignores an envelope without its signature and files that are not updates', () => {
      saveLinkRegistryUpdate(updateDir, 2026093001, bytes('v2026093001'), 'aa');
      rmSync(join(updateDir, 'links-2026093001.sig'));
      writeFileSync(join(updateDir, 'notes.txt'), 'x');
      writeFileSync(join(updateDir, 'links-abc.json'), 'x');
      assert.strictEqual(load().source, 'bundled');
      assert.isTrue(
        existsSync(join(updateDir, 'notes.txt')),
        'other files are left alone'
      );
    });

    it('does not break without an update directory', () => {
      assert.isFalse(existsSync(updateDir));
      assert.strictEqual(load().source, 'bundled');
    });

    it('throws when the bundled registry cannot be loaded, so the caller can show previews the way Signal does', () => {
      const deps = makeDeps();
      deps.load = () => {
        throw new Error('corrupt');
      };
      assert.throws(() => load(deps));
    });
  });

  describe('saveLinkRegistryUpdate', () => {
    it('keeps the two newest and never leaves a half-written file', () => {
      for (const version of [2026093001, 2026093002, 2026093003]) {
        saveLinkRegistryUpdate(updateDir, version, bytes(`v${version}`), 'aa');
      }
      assert.deepEqual(readdirSync(updateDir).sort(), [
        'links-2026093002.json',
        'links-2026093002.sig',
        'links-2026093003.json',
        'links-2026093003.sig',
      ]);
    });
  });

  describe('parseLinkRegistryPointer', () => {
    const good = {
      version: 2026093001,
      schema: 1,
      url: 'https://updates.tellomi.app/links/s1/links-2026093001.json',
      sha256: 'a'.repeat(64),
      sig: 'ab'.repeat(64),
    };
    const parse = (value: unknown) =>
      parseLinkRegistryPointer(value, 'https://updates.tellomi.app', 1);

    it('reads a well-formed pointer', () => {
      assert.deepEqual(parse(good), good);
    });

    it('rejects anything malformed', () => {
      assert.isUndefined(parse(undefined));
      assert.isUndefined(parse('x'));
      assert.isUndefined(parse({ ...good, version: '2026093001' }));
      assert.isUndefined(parse({ ...good, version: 0 }));
      assert.isUndefined(parse({ ...good, version: 1.5 }));
      assert.isUndefined(parse({ ...good, schema: 2 }));
      assert.isUndefined(parse({ ...good, sha256: 'a'.repeat(63) }));
      assert.isUndefined(parse({ ...good, sha256: 'z'.repeat(64) }));
      assert.isUndefined(parse({ ...good, sig: 'not hex' }));
      assert.isUndefined(parse({ ...good, sig: '' }));
    });

    it('only follows an https url on the update host', () => {
      assert.isUndefined(
        parse({ ...good, url: 'http://updates.tellomi.app/x.json' })
      );
      assert.isUndefined(
        parse({ ...good, url: 'https://evil.example/x.json' })
      );
      assert.isUndefined(
        parse({
          ...good,
          url: 'https://updates.tellomi.app.evil.example/x.json',
        })
      );
      assert.isUndefined(parse({ ...good, url: 'not a url' }));
      assert.isUndefined(
        parse({ ...good, url: 'https://user:pw@updates.tellomi.app/x.json' })
      );
    });
  });

  describe('checkForLinkRegistryUpdate', () => {
    const envelope = bytes('v2026093001');
    const pointer = (overrides: Record<string, unknown> = {}) => ({
      version: 2026093001,
      schema: 1,
      url: 'https://updates.tellomi.app/links/s1/links-2026093001.json',
      sha256: sha256(envelope),
      sig: 'aa',
      ...overrides,
    });

    function run(options: {
      pointer?: unknown;
      body?: Uint8Array<ArrayBuffer>;
      current?: bigint;
      deps?: ReturnType<typeof makeDeps>;
      fail?: boolean;
    }) {
      const urls: Array<string> = [];
      const deps = options.deps ?? makeDeps();
      const promise = checkForLinkRegistryUpdate({
        resourcesUrl: 'https://updates.tellomi.app',
        schema: 1,
        current: options.current ?? 2026092702n,
        publicKey,
        updateDir,
        deps,
        fetchBytes: async (url, maxBytes) => {
          urls.push(url);
          if (options.fail) {
            throw new Error('network');
          }
          if (url.endsWith('latest.json')) {
            return bytes(JSON.stringify(options.pointer ?? pointer()));
          }
          const body = options.body ?? envelope;
          assert.isAtMost(body.length, maxBytes);
          return body;
        },
      });
      return { promise, urls, deps };
    }

    it('asks the pointer of the schema this build reads, then downloads, verifies and stores it', async () => {
      const { promise, urls } = run({});
      assert.deepEqual(await promise, {
        status: 'updated',
        version: 2026093001n,
      });
      assert.deepEqual(urls, [
        'https://updates.tellomi.app/links/s1/latest.json',
        'https://updates.tellomi.app/links/s1/links-2026093001.json',
      ]);
      assert.strictEqual(load().source, 'update');
    });

    it('does not download what is not newer than the version in use', async () => {
      const { promise, urls } = run({ current: 2026093001n });
      assert.strictEqual((await promise).status, 'current');
      assert.lengthOf(urls, 1);
    });

    it('does not store a download whose hash is not the pointer’s', async () => {
      const { promise } = run({ body: bytes('v2026093001-tampered') });
      assert.strictEqual((await promise).status, 'rejected');
      assert.isFalse(existsSync(updateDir));
    });

    it('does not store what rust/links rejects (bad signature, schema, rules, not newer)', async () => {
      const cases = [
        [bytes('v2026093001'), 'bb'],
        [bytes('v2026093001:schema'), 'aa'],
        [bytes('v2026093001:rules'), 'aa'],
      ] as const;
      const results = await Promise.all(
        cases.map(
          ([body, sig]) =>
            run({ pointer: pointer({ sha256: sha256(body), sig }), body })
              .promise
        )
      );
      assert.deepEqual(
        results.map(result => result.status),
        ['rejected', 'rejected', 'rejected']
      );
      assert.isFalse(existsSync(updateDir));
    });

    it('a malformed pointer or a network failure changes nothing and does not throw', async () => {
      assert.strictEqual(
        (await run({ pointer: { version: 'x' } }).promise).status,
        'failed'
      );
      assert.strictEqual((await run({ fail: true }).promise).status, 'failed');
      assert.isFalse(existsSync(updateDir));
    });

    it('a pointer that follows a different host is not followed', async () => {
      const { promise, urls } = run({
        pointer: pointer({ url: 'https://evil.example/x.json' }),
      });
      assert.strictEqual((await promise).status, 'failed');
      assert.lengthOf(urls, 1);
    });
  });
});
