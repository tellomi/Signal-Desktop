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

// ADR-0063 §5.4 row 3, §8.1 row 3, §8.4 third bullet: on Desktop a hot update that drops a provider
// to a brand shell takes effect without a release. On the sender it stops the fetching; on the
// receiver an old message that came in as a structured card is now drawn as the brand shell only,
// because the level is decided at display time from the raw `rich` that was stored (§5.1 rule 4).
// This runs the real rust/links, a real signature (a throwaway key; the release key is not here)
// and the real store the app uses, over the same message before and after each update.

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<
    Readonly<{ name: string; preview: string; body: string; message: string }>
  >;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

const bundledBytes = new Uint8Array(
  readFileSync(join(FIXTURES, golden.registry))
);
const bundled = LinkRegistry.load(bundledBytes);
const NEXT = bundled.version + 1n;

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

type Provider = { id: string; tier: string; route: Array<{ plan: unknown }> };
type Envelope = {
  version: number;
  schema: number;
  payload: { providers: Array<Provider> };
};

function goldenCase(prefix: string) {
  const found = golden.classify.find(testCase =>
    testCase.name.startsWith(prefix)
  );
  if (!found) {
    throw new Error(`no golden case starting with ${prefix}`);
  }
  return found;
}

// The stored message: a structured bilibili video with the sender's rich content (level 2), as a
// Signal-family client stored it when it arrived.
const OLD_MESSAGE = goldenCase(
  'structured video: sender level 2, required fields present'
);
const BILIBILI_URL = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';

function cardOf(registry: LinkRegistry, testCase = OLD_MESSAGE) {
  return JSON.parse(
    registry.classify(testCase.preview, testCase.body, testCase.message || '{}')
  );
}

// What the sender's first step is: `fetch` (it will go and get the page) or nothing (brand shell).
function senderFirstRequest(registry: LinkRegistry): string | null {
  const job = registry.begin(
    BILIBILI_URL,
    JSON.stringify({
      region: 'global',
      unreachable_hosts: [],
      expand_short_links: true,
      locale: 'en',
    })
  );
  const json = job.nextRequest();
  return json == null ? null : JSON.parse(json).type;
}

// The bundled envelope, changed by `mutate`, with a newer version, signed like scripts/links/build.py
// does (XEdDSA over the raw bytes).
function makeUpdate({
  version = NEXT,
  signer = key,
  mutate = () => undefined,
  overrides = {},
}: {
  version?: bigint;
  signer?: PrivateKey;
  mutate?: (payload: Envelope['payload']) => void;
  overrides?: Record<string, unknown>;
}): { bytes: Uint8Array<ArrayBuffer>; signatureHex: string } {
  const envelope: Envelope = JSON.parse(
    Buffer.from(bundledBytes).toString('utf8')
  );
  mutate(envelope.payload);
  const bytes = new Uint8Array(
    Buffer.from(
      JSON.stringify({ ...envelope, version: Number(version), ...overrides })
    )
  );
  return {
    bytes,
    signatureHex: Buffer.from(signer.sign(bytes)).toString('hex'),
  };
}

function bilibili(payload: Envelope['payload']): Provider {
  const found = payload.providers.find(provider => provider.id === 'bilibili');
  if (!found) {
    throw new Error('the registry has no bilibili');
  }
  return found;
}

// The operator's emergency stop: the provider becomes a brand shell (plan none on every route; the
// loader refuses `tier = brand` with any other plan, rule L10).
function downgradeBilibili(payload: Envelope['payload']): void {
  const provider = bilibili(payload);
  provider.tier = 'brand';
  for (const route of provider.route) {
    route.plan = [{ type: 'none' }];
  }
}

function removeBilibili(payload: Envelope['payload']): void {
  const index = payload.providers.findIndex(
    provider => provider.id === 'bilibili'
  );
  payload.providers.splice(index, 1);
}

describe('a hot update that drops a provider (real rust/links)', () => {
  let dir: string;
  let updateDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'link-registry-downgrade-'));
    updateDir = join(dir, 'updates');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // What the app does at start and after an update was stored.
  const load = () =>
    loadBestLinkRegistry({
      bundledPath: join(FIXTURES, golden.registry),
      updateDir,
      publicKey,
      deps,
    });

  const install = (
    update: ReturnType<typeof makeUpdate>,
    version: bigint = NEXT
  ) =>
    saveLinkRegistryUpdate(
      updateDir,
      Number(version),
      update.bytes,
      update.signatureHex
    );

  describe('with the bundled registry (before)', () => {
    it('draws the old message as a structured card and the sender goes to fetch the page', () => {
      const card = cardOf(bundled);
      assert.strictEqual(card.level, 'structured');
      assert.strictEqual(card.provider, 'bilibili');
      assert.strictEqual(card.kind, 'video');
      assert.isString(card.title);
      assert.isAbove(card.attrs.length, 0);
      assert.isTrue(card.show_image);
      assert.strictEqual(senderFirstRequest(bundled), 'fetch');
    });
  });

  describe('a newer, correctly signed update that makes the provider a brand shell', () => {
    it('is taken: the app now runs it', () => {
      install(makeUpdate({ mutate: downgradeBilibili }));
      const { registry, source } = load();
      assert.strictEqual(source, 'update');
      assert.strictEqual(registry.version, NEXT);
    });

    it('draws the very same old message as the brand shell only', () => {
      // The stored preview and body are byte for byte what the bundled registry was given above.
      const before = cardOf(bundled);
      install(makeUpdate({ mutate: downgradeBilibili }));
      const after = cardOf(load().registry);

      assert.strictEqual(before.level, 'structured');
      assert.strictEqual(after.level, 'brand');
      // Only the platform and what kind of thing it is: nothing the sender wrote.
      assert.strictEqual(after.provider, 'bilibili');
      assert.strictEqual(after.kind, 'video');
      assert.isNull(after.title);
      assert.isNull(after.description);
      assert.deepEqual(after.attrs, []);
      assert.isFalse(after.show_image, 'the sender’s picture is not shown');
      assert.isNull(after.first_party);
      assert.isFalse(after.official_badge);
    });

    it('makes the sender stop fetching and send the brand shell', () => {
      install(makeUpdate({ mutate: downgradeBilibili }));
      const { registry } = load();
      const job = registry.begin(
        BILIBILI_URL,
        JSON.stringify({
          region: 'global',
          unreachable_hosts: [],
          expand_short_links: true,
          locale: 'en',
        })
      );
      assert.isNull(job.nextRequest(), 'no request is made for the page');
      const outcome = JSON.parse(job.finish());
      assert.strictEqual(outcome.level, 'brand');
      assert.strictEqual(outcome.provider, 'bilibili');
      assert.strictEqual(outcome.preview.title, 'Bilibili');
      assert.isNull(outcome.preview.image_url);
      assert.strictEqual(outcome.preview.rich.level, 1);
      assert.deepEqual(outcome.preview.rich.attrs, []);
    });

    it('leaves every other provider and the first-party cards as they were', () => {
      install(makeUpdate({ mutate: downgradeBilibili }));
      const updated = load().registry;
      for (const prefix of [
        'place from the URL',
        '§6.1 brand-tier platform claiming a structured card',
        'payment platform',
        'tell.cc user without rich',
        'group: name from the snapshot',
        'sticker pack',
        '§6.1 official card: badge from the host',
        'no provider and no title',
        "old sender, no rich: generic (§5.3 'old client' / 'no rich')",
      ]) {
        const testCase = goldenCase(prefix);
        assert.deepEqual(
          cardOf(updated, testCase),
          cardOf(bundled, testCase),
          prefix
        );
      }
    });

    it('does not rewrite the message: the same stored bytes give the old card again from the bundled registry', () => {
      // The effect is at display time; nothing stored is touched.
      install(makeUpdate({ mutate: downgradeBilibili }));
      load();
      assert.strictEqual(cardOf(bundled).level, 'structured');
    });
  });

  describe('an update that removes the provider', () => {
    it('draws the old message from its snapshot (generic) and the sender falls back to generic', () => {
      install(makeUpdate({ mutate: removeBilibili }));
      const { registry, source } = load();
      assert.strictEqual(source, 'update');
      const card = cardOf(registry);
      assert.strictEqual(card.level, 'generic');
      assert.isNull(card.provider);
      assert.isString(card.title, 'the snapshot title is what shows');
      assert.deepEqual(card.attrs, []);
      // A page nobody knows is fetched the generic way.
      assert.strictEqual(senderFirstRequest(registry), 'fetch');
    });
  });

  describe('an update that does not pass keeps the bundled registry, and the old message as it was', () => {
    const cases: ReadonlyArray<
      Readonly<{
        name: string;
        update: () => ReturnType<typeof makeUpdate>;
        version?: bigint;
      }>
    > = [
      {
        name: 'signed with another key',
        update: () =>
          makeUpdate({ signer: otherKey, mutate: downgradeBilibili }),
      },
      {
        name: 'changed after it was signed',
        update: () => {
          const signed = makeUpdate({ mutate: downgradeBilibili });
          return {
            bytes: new Uint8Array(
              Buffer.from(`${Buffer.from(signed.bytes).toString('utf8')} `)
            ),
            signatureHex: signed.signatureHex,
          };
        },
      },
      {
        name: 'the same version as the bundled one',
        version: bundled.version,
        update: () =>
          makeUpdate({ version: bundled.version, mutate: downgradeBilibili }),
      },
      {
        name: 'an older version',
        version: bundled.version - 1n,
        update: () =>
          makeUpdate({
            version: bundled.version - 1n,
            mutate: downgradeBilibili,
          }),
      },
      {
        name: 'an envelope schema this build does not read',
        update: () =>
          makeUpdate({ mutate: downgradeBilibili, overrides: { schema: 99 } }),
      },
      {
        name: 'a downgrade that breaks the rules (brand tier with a fetching plan, L10)',
        update: () =>
          makeUpdate({
            mutate: payload => {
              bilibili(payload).tier = 'brand';
            },
          }),
      },
    ];

    for (const { name, update, version = NEXT } of cases) {
      it(name, () => {
        install(update(), version);
        const { registry, source } = load();
        assert.strictEqual(source, 'bundled');
        assert.strictEqual(registry.version, bundled.version);
        assert.strictEqual(cardOf(registry).level, 'structured');
        assert.strictEqual(senderFirstRequest(registry), 'fetch');
      });
    }
  });

  describe('through the download the main process does', () => {
    function serve(update: ReturnType<typeof makeUpdate>, version: bigint) {
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
    }

    const check = (fetchBytes: ReturnType<typeof serve>) =>
      checkForLinkRegistryUpdate({
        resourcesUrl: 'https://updates.tellomi.app',
        current: bundled.version,
        publicKey,
        updateDir,
        deps,
        fetchBytes,
      });

    it('stores the downgrade, and then the old message is the brand shell', async () => {
      const result = await check(
        serve(makeUpdate({ mutate: downgradeBilibili }), NEXT)
      );
      assert.deepEqual(result, { status: 'updated', version: NEXT });
      const { registry, source } = load();
      assert.strictEqual(source, 'update');
      assert.strictEqual(cardOf(registry).level, 'brand');
    });

    it('does not store a downgrade signed by another key', async () => {
      const result = await check(
        serve(makeUpdate({ signer: otherKey, mutate: downgradeBilibili }), NEXT)
      );
      assert.strictEqual(result.status, 'rejected');
      const { registry, source } = load();
      assert.strictEqual(source, 'bundled');
      assert.strictEqual(cardOf(registry).level, 'structured');
    });
  });
});
