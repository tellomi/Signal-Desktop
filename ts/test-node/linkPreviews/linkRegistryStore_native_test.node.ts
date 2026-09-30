// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { PrivateKey } from '@signalapp/libsignal-client';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import {
  checkForLinkRegistryUpdate,
  loadBestLinkRegistry,
  saveLinkRegistryUpdate,
} from '../../linkPreviews/linkRegistryStore.node.ts';

// ADR-0063 §6.4 / §7.3, §8.1 rows 2–3 (tellomi/tellomi#1421): the same paths as linkRegistryStore_test.node.ts, but
// through the real rust/links `loadUpdate` and a real XEdDSA signature (a throwaway key; the release key is not here).

const FIXTURES = join(cwd(), 'fixtures', 'links');
const bundledPath = join(
  FIXTURES,
  (
    JSON.parse(readFileSync(join(FIXTURES, 'classify-smoke.json'), 'utf8')) as {
      registry: string;
    }
  ).registry
);
const bundledBytes = new Uint8Array(readFileSync(bundledPath));
const bundledVersion = LinkRegistry.load(bundledBytes).version;

const key = PrivateKey.generate();
const otherKey = PrivateKey.generate();
const publicKey = key.getPublicKey().serialize();

const deps = {
  load: (envelope: Uint8Array<ArrayBuffer>) => LinkRegistry.load(envelope),
  loadUpdate: (
    envelope: Uint8Array<ArrayBuffer>,
    signatureHex: string,
    pub: Uint8Array<ArrayBuffer>,
    current: bigint | null
  ) => LinkRegistry.loadUpdate(envelope, signatureHex, pub, current),
};

// The bundled envelope with a newer version, signed like scripts/links/build.py does (XEdDSA over the raw bytes).
function makeUpdate(
  version: bigint,
  signer: PrivateKey = key,
  overrides: Record<string, unknown> = {}
): { bytes: Uint8Array<ArrayBuffer>; signatureHex: string } {
  const parsed = JSON.parse(Buffer.from(bundledBytes).toString('utf8'));
  const envelope = { ...parsed, version: Number(version), ...overrides };
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(envelope)));
  return {
    bytes,
    signatureHex: Buffer.from(signer.sign(bytes)).toString('hex'),
  };
}

describe('link registry hot update (real rust/links)', () => {
  let dir: string;
  let updateDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'link-registry-native-'));
    updateDir = join(dir, 'updates');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const load = () =>
    loadBestLinkRegistry({ bundledPath, updateDir, publicKey, deps });

  const store = (update: ReturnType<typeof makeUpdate>, version: bigint) =>
    saveLinkRegistryUpdate(
      updateDir,
      Number(version),
      update.bytes,
      update.signatureHex
    );

  it('takes a newer, correctly signed registry', () => {
    const version = bundledVersion + 1n;
    store(makeUpdate(version), version);
    const { registry, source } = load();
    assert.strictEqual(source, 'update');
    assert.strictEqual(registry.version, version);
  });

  it('keeps the bundled one for a signature made with another key', () => {
    const version = bundledVersion + 1n;
    store(makeUpdate(version, otherKey), version);
    assert.strictEqual(load().source, 'bundled');
  });

  it('keeps the bundled one for an envelope changed after it was signed', () => {
    const version = bundledVersion + 1n;
    const update = makeUpdate(version);
    const tampered = new Uint8Array(
      Buffer.from(Buffer.from(update.bytes).toString('utf8') + ' ')
    );
    store({ bytes: tampered, signatureHex: update.signatureHex }, version);
    assert.strictEqual(load().source, 'bundled');
  });

  it('keeps the bundled one for the same or an older version', () => {
    store(makeUpdate(bundledVersion), bundledVersion);
    assert.strictEqual(load().source, 'bundled');
    store(makeUpdate(bundledVersion - 1n), bundledVersion - 1n);
    assert.strictEqual(load().source, 'bundled');
  });

  it('keeps the bundled one for a schema this build does not read', () => {
    const version = bundledVersion + 1n;
    store(makeUpdate(version, key, { schema: 99 }), version);
    assert.strictEqual(load().source, 'bundled');
  });

  it('downloads, verifies and stores a newer one, and refuses a bad one', async () => {
    const version = bundledVersion + 1n;
    const good = makeUpdate(version);
    const serve = (update: ReturnType<typeof makeUpdate>) => {
      const pointer = {
        version: Number(version),
        schema: 1,
        url: 'https://updates.tellomi.app/links/s1/links.json',
        sha256: createHash('sha256').update(update.bytes).digest('hex'),
        sig: update.signatureHex,
      };
      return async (url: string) =>
        url.endsWith('latest.json')
          ? new Uint8Array(Buffer.from(JSON.stringify(pointer)))
          : update.bytes;
    };
    const check = (
      fetchBytes: (url: string) => Promise<Uint8Array<ArrayBuffer>>
    ) =>
      checkForLinkRegistryUpdate({
        resourcesUrl: 'https://updates.tellomi.app',
        current: bundledVersion,
        publicKey,
        updateDir,
        deps,
        fetchBytes,
      });

    const bad = await check(serve(makeUpdate(version, otherKey)));
    assert.strictEqual(bad.status, 'rejected');
    assert.strictEqual(load().source, 'bundled');

    const result = await check(serve(good));
    assert.deepEqual(result, { status: 'updated', version });
    assert.strictEqual(load().registry.version, version);
  });
});
