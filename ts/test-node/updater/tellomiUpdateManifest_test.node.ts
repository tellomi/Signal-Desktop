// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKey } from '@signalapp/libsignal-client';

import { verify } from '../../updater/curve.node.ts';
import type { UpdateManifestDeps } from '../../updater/tellomiUpdateManifest.node.ts';
import {
  checkForUpdateManifest,
  loadCachedUpdateManifest,
  updateManifestUrl,
} from '../../updater/tellomiUpdateManifest.node.ts';
import { DialogType } from '../../types/Dialogs.std.ts';
import {
  desktopBuild,
  evaluateUpdateTier,
  parseUpdateManifest,
  requiredButtonState,
  shouldAutoShowRequiredLayer,
  shouldShowRecommendedCard,
} from '../../util/tellomiUpdateManifest.std.ts';

// Tellomi (tellomi/tellomi#1399, spec app-update-and-version-policy.md §3.2.1): Desktop reads the signed update
// manifest the same way Android and iOS do -- signature, then name / schema / platform / channel, then serial >= cache.
describe('Tellomi update manifest (Desktop)', () => {
  const key = PrivateKey.generate();
  const publicKey = key.getPublicKey().serialize();

  function manifest(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      name: 'tellomi-update',
      schema: 1,
      platform: 'desktop',
      channel: 'website',
      serial: 20261015120000,
      issuedAt: '2026-10-15T12:00:00Z',
      latest: {
        version: '0.1.13',
        build: 1013,
        releaseDate: '2026-10-15T12:00:00Z',
        url: 'https://www.tellomi.app/download/',
      },
      recommendedMinBuild: 0,
      requiredMinBuild: 0,
      notesUrl: 'https://www.tellomi.app/changelog/#desktop',
      ...overrides,
    };
  }

  function bytesOf(m: Record<string, unknown>): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
      Buffer.from(`${JSON.stringify(m, null, 2)}\n`, 'utf-8')
    );
  }

  function signatureOf(
    bytes: Uint8Array<ArrayBuffer>,
    signer = key
  ): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
      Buffer.from(`${Buffer.from(signer.sign(bytes)).toString('hex')}\n`)
    );
  }

  function deps(
    files: Map<string, Uint8Array<ArrayBuffer>>,
    fetched: Array<string> = []
  ): UpdateManifestDeps {
    return {
      fetchBytes: async (url: string, maxBytes: number) => {
        fetched.push(url);
        const body = files.get(url);
        if (body === undefined) {
          throw new Error('HTTP 404');
        }
        if (body.length > maxBytes) {
          throw new Error('too large');
        }
        return body;
      },
      verify,
    };
  }

  const updatesUrl = 'https://updates.tellomi.app/desktop';
  const url = 'https://updates.tellomi.app/update/v1/desktop-website.json';

  let cacheDir: string;
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'tellomi-update-manifest-'));
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('desktopBuild', () => {
    it('is major * 1000000 + minor * 1000 + patch, like the release script', () => {
      assert.strictEqual(desktopBuild('0.1.12'), 1012);
      assert.strictEqual(desktopBuild('1.0.0'), 1_000_000);
      assert.strictEqual(desktopBuild('0.1.13-beta.1'), 1013);
      assert.isAbove(desktopBuild('0.2.0') ?? 0, desktopBuild('0.1.999') ?? 0);
      assert.isUndefined(desktopBuild('0.1'));
      assert.isUndefined(desktopBuild('0.1.1000'));
    });
  });

  describe('parseUpdateManifest', () => {
    it('reads the fields and ignores unknown ones', () => {
      const parsed = parseUpdateManifest(
        bytesOf(manifest({ somethingNew: true }))
      );
      assert.strictEqual(parsed?.latest.build, 1013);
      assert.strictEqual(
        parsed?.notesUrl,
        'https://www.tellomi.app/changelog/#desktop'
      );
    });

    it('refuses another platform or channel, another name or schema, and broken fields', () => {
      for (const wrong of [
        { platform: 'android' },
        { channel: 'testflight' },
        { name: 'links' },
        { schema: 2 },
        { serial: 0 },
        { recommendedMinBuild: -1 },
        { requiredReason: 'because' },
        { requiredFrom: 'tomorrow' },
        { latest: { version: '0.1.13' } },
      ]) {
        assert.isUndefined(
          parseUpdateManifest(bytesOf(manifest(wrong))),
          JSON.stringify(wrong)
        );
      }
      assert.isUndefined(
        parseUpdateManifest(new Uint8Array(Buffer.from('not json')))
      );
    });
  });

  describe('evaluateUpdateTier', () => {
    const now = Date.parse('2026-10-16T00:00:00Z');
    const parse = (overrides: Record<string, unknown>) =>
      parseUpdateManifest(bytesOf(manifest(overrides)));

    it('is optional when only a newer version exists, none when this is the latest', () => {
      assert.strictEqual(
        evaluateUpdateTier(parse({}), 1012, now).tier,
        'optional'
      );
      assert.strictEqual(evaluateUpdateTier(parse({}), 1013, now).tier, 'none');
      assert.strictEqual(evaluateUpdateTier(undefined, 1012, now).tier, 'none');
      assert.strictEqual(
        evaluateUpdateTier(parse({}), undefined, now).tier,
        'none'
      );
    });

    it('is recommended below recommendedMinBuild', () => {
      const state = evaluateUpdateTier(
        parse({ recommendedMinBuild: 1013 }),
        1012,
        now
      );
      assert.strictEqual(state.tier, 'recommended');
      assert.strictEqual(state.latestVersion, '0.1.13');
    });

    it('is required below requiredMinBuild once requiredFrom has passed, recommended before', () => {
      const required = parse({
        requiredMinBuild: 1013,
        requiredReason: 'security',
      });
      assert.deepInclude(evaluateUpdateTier(required, 1012, now), {
        tier: 'required',
        requiredReason: 'security',
      });
      const later = parse({
        requiredMinBuild: 1013,
        requiredReason: 'protocol',
        requiredFrom: '2026-10-20T00:00:00Z',
      });
      assert.strictEqual(
        evaluateUpdateTier(later, 1012, now).tier,
        'recommended'
      );
      assert.strictEqual(
        evaluateUpdateTier(later, 1012, Date.parse('2026-10-20T00:00:00Z'))
          .tier,
        'required'
      );
      assert.strictEqual(
        evaluateUpdateTier(required, 1013, now).tier,
        'none',
        'the latest build is never blocked'
      );
    });
  });

  describe('shouldShowRecommendedCard', () => {
    it('shows the card once per recommended version, never for the other tiers', () => {
      const recommended = {
        tier: 'recommended' as const,
        latestVersion: '0.1.13',
      };
      assert.isTrue(shouldShowRecommendedCard(recommended, undefined));
      assert.isTrue(
        shouldShowRecommendedCard(recommended, '0.1.12'),
        'a newer version brings it back'
      );
      assert.isFalse(shouldShowRecommendedCard(recommended, '0.1.13'));
      assert.isFalse(
        shouldShowRecommendedCard(
          { tier: 'optional', latestVersion: '0.1.13' },
          undefined
        )
      );
      assert.isFalse(
        shouldShowRecommendedCard(
          { tier: 'required', latestVersion: '0.1.13' },
          undefined
        )
      );
      assert.isFalse(shouldShowRecommendedCard({ tier: 'none' }, undefined));
    });
  });

  describe('shouldAutoShowRequiredLayer', () => {
    it('shows the update-required page unless this app version chose read-only', () => {
      const required = {
        tier: 'required' as const,
        latestVersion: '0.1.13',
        requiredReason: 'security' as const,
      };
      assert.isTrue(shouldAutoShowRequiredLayer(required, undefined, '0.1.12'));
      assert.isFalse(
        shouldAutoShowRequiredLayer(required, '0.1.12', '0.1.12'),
        'chose "just view my chats" on this version'
      );
      assert.isTrue(
        shouldAutoShowRequiredLayer(required, '0.1.11', '0.1.12'),
        'the choice was made on an older version'
      );
      assert.isFalse(
        shouldAutoShowRequiredLayer(
          { tier: 'recommended', latestVersion: '0.1.13' },
          undefined,
          '0.1.12'
        )
      );
    });
  });

  describe('requiredButtonState', () => {
    it('follows the self-updater: update, downloading with progress, restart', () => {
      assert.deepEqual(requiredButtonState({ dialogType: DialogType.None }), {
        kind: 'update',
      });
      assert.deepEqual(
        requiredButtonState({ dialogType: DialogType.DownloadReady }),
        { kind: 'update' }
      );
      assert.deepEqual(
        requiredButtonState({
          dialogType: DialogType.Downloading,
          downloadSize: 200,
          downloadedSize: 85,
        }),
        { kind: 'downloading', percent: 42 }
      );
      assert.deepEqual(
        requiredButtonState({
          dialogType: DialogType.Downloading,
          downloadSize: 100,
          downloadedSize: 130,
        }),
        { kind: 'downloading', percent: 100 }
      );
      assert.deepEqual(
        requiredButtonState({ dialogType: DialogType.Downloading }),
        { kind: 'downloading', percent: undefined },
        'size not known yet'
      );
      assert.deepEqual(
        requiredButtonState({ dialogType: DialogType.DownloadedUpdate }),
        { kind: 'restart' }
      );
      assert.deepEqual(
        requiredButtonState({ dialogType: DialogType.AutoUpdate }),
        { kind: 'restart' }
      );
    });
  });

  describe('checkForUpdateManifest', () => {
    it('reads the manifest next to the self-update feed', () => {
      assert.strictEqual(updateManifestUrl(updatesUrl), url);
      assert.strictEqual(updateManifestUrl(`${updatesUrl}/`), url);
      assert.strictEqual(
        updateManifestUrl('https://updates.tellomi.cn/desktop'),
        'https://updates.tellomi.cn/update/v1/desktop-website.json'
      );
    });

    it('takes a signed manifest, caches it, and reads the cache back after re-verifying it', async () => {
      const bytes = bytesOf(manifest());
      const result = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, bytes],
            [`${url}.sig`, signatureOf(bytes)],
          ])
        ),
      });
      assert.strictEqual(result.status, 'updated');
      assert.strictEqual(result.manifest?.serial, 20261015120000);
      assert.strictEqual(
        loadCachedUpdateManifest({ cacheDir, publicKey, verify })?.serial,
        20261015120000
      );

      // The cache is verified on every read: a tampered file is as good as no cache.
      writeFileSync(
        join(cacheDir, 'desktop-website.json'),
        bytesOf(manifest({ requiredMinBuild: 1013, requiredReason: 'other' }))
      );
      assert.isUndefined(
        loadCachedUpdateManifest({ cacheDir, publicKey, verify })
      );
    });

    it('keeps the cache when the new file is signed by another key, unsigned, or older', async () => {
      const first = bytesOf(manifest());
      await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, first],
            [`${url}.sig`, signatureOf(first)],
          ])
        ),
      });

      const forged = bytesOf(
        manifest({
          serial: 20261016000000,
          requiredMinBuild: 1013,
          requiredReason: 'security',
        })
      );
      const otherKey = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, forged],
            [`${url}.sig`, signatureOf(forged, PrivateKey.generate())],
          ])
        ),
      });
      assert.strictEqual(otherKey.status, 'rejected');
      assert.strictEqual(otherKey.manifest?.serial, 20261015120000);

      const unsigned = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(new Map([[url, forged]])),
      });
      assert.strictEqual(unsigned.status, 'failed');
      assert.strictEqual(unsigned.manifest?.serial, 20261015120000);

      // A genuine but older manifest (say, a revoked "required" one) cannot be replayed.
      const older = bytesOf(
        manifest({
          serial: 20261014000000,
          requiredMinBuild: 1013,
          requiredReason: 'security',
        })
      );
      const replay = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, older],
            [`${url}.sig`, signatureOf(older)],
          ])
        ),
      });
      assert.strictEqual(replay.status, 'rejected');
      assert.strictEqual(replay.manifest?.requiredMinBuild, 0);

      const same = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, first],
            [`${url}.sig`, signatureOf(first)],
          ])
        ),
      });
      assert.strictEqual(same.status, 'current');
    });

    it('accepts a manifest signed by the release script (scripts/release/update_manifest.py, XEdDSA over the raw bytes)', async () => {
      // Fixture made with the superproject's signer and a throwaway test key (not the release key).
      const fixtures = join(__dirname, 'fixtures');
      const bytes = new Uint8Array(
        readFileSync(join(fixtures, 'desktop-website.json'))
      );
      const signature = new Uint8Array(
        readFileSync(join(fixtures, 'desktop-website.json.sig'))
      );
      const fixtureKey = new Uint8Array(
        Buffer.from(
          readFileSync(join(fixtures, 'desktop-website.pub'), 'utf-8').trim(),
          'hex'
        )
      );
      const result = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey: fixtureKey,
        deps: deps(
          new Map([
            [url, bytes],
            [`${url}.sig`, signature],
          ])
        ),
      });
      assert.strictEqual(result.status, 'updated');
      assert.deepInclude(
        evaluateUpdateTier(result.manifest, desktopBuild('0.1.12'), Date.now()),
        {
          tier: 'recommended',
          latestVersion: '0.1.13',
        }
      );
    });

    it('a newer manifest that lowers the bar replaces the cache (revocation)', async () => {
      const required = bytesOf(
        manifest({ requiredMinBuild: 1013, requiredReason: 'security' })
      );
      await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, required],
            [`${url}.sig`, signatureOf(required)],
          ])
        ),
      });
      const revoked = bytesOf(manifest({ serial: 20261015130000 }));
      const result = await checkForUpdateManifest({
        updatesUrl,
        cacheDir,
        publicKey,
        deps: deps(
          new Map([
            [url, revoked],
            [`${url}.sig`, signatureOf(revoked)],
          ])
        ),
      });
      assert.strictEqual(result.status, 'updated');
      assert.strictEqual(
        evaluateUpdateTier(result.manifest, 1012, Date.now()).tier,
        'optional'
      );
    });
  });
});
