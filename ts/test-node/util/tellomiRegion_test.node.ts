// Copyright 2026 Tellomi
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LookupFunction } from 'node:net';
import { assert } from 'chai';

import {
  REGION_SELECTOR_DEFAULTS,
  RegionSelector,
  applyRegionEndpoints,
  getEnabledRegions,
  rebaseOrigin,
  getRegionEndpoints,
  parseRegions,
  selectStartupRegion,
} from '../../util/tellomiRegion.std.ts';
import type {
  RegionIdType,
  RegionProbeResultType,
  RegionsType,
} from '../../util/tellomiRegion.std.ts';
import { createChatProbe } from '../../util/tellomiRegionProbe.node.ts';
import { MINUTE } from '../../util/durations/index.std.ts';

const CONFIG_DIR = join(__dirname, '../../../config');

function readConfig(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CONFIG_DIR, name), 'utf8'));
}

// What the global region must equal, byte for byte: the endpoints production.json and
// default.json carried before regions existed, plus the hosts Desktop used to hardcode
// (networkObserver's outage host, uploadDebugLog's debuglogs URL).
const GLOBAL_TODAY = {
  serverUrl: 'https://chat.tellomi.app',
  libsignalHostname: 'grpc.chat.tellomi.app',
  storageUrl: 'https://storage.tellomi.app',
  cdn: {
    '0': 'https://cdn.tellomi.app',
    '2': 'https://cdn2.tellomi.app',
    '3': 'https://cdn3.tellomi.app',
  },
  sfuUrl: 'https://chat.tellomi.app/callingService',
  challengeUrl:
    'https://chat.tellomi.app/captcha-tellomi/challenge/generate.html',
  registrationChallengeUrl:
    'https://chat.tellomi.app/captcha-tellomi/registration/generate.html',
  contentProxyUrl: 'https://contentproxy.tellomi.app:443',
  updatesUrl: 'https://updates.tellomi.app/desktop',
  resourcesUrl: 'https://updates.tellomi.app',
  outageCheckHost: 'uptime.tellomi.app',
  debugLogUrl: 'https://chat.tellomi.app/debuglogs',
};

function strings(value: unknown): Array<string> {
  if (typeof value === 'string') {
    return [value];
  }
  if (value != null && typeof value === 'object') {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

function hostOf(value: string): string {
  return value.includes('://') ? new URL(value).hostname : value;
}

// node-config merge order for NODE_ENV=production: default.json, then production.json on top.
function mergeDeep(
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key];
    out[key] =
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev != null &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
        ? mergeDeep(
            prev as Record<string, unknown>,
            value as Record<string, unknown>
          )
        : value;
  }
  return out;
}

function productionRegions(): RegionsType {
  return parseRegions(readConfig('production.json').regions);
}

describe('Tellomi regions (tellomi/tellomi#1054)', () => {
  describe('config/production.json', () => {
    it('global carries exactly the endpoints the app used before regions', () => {
      const regions = productionRegions();
      assert.isTrue(regions.global.enabled);
      assert.deepStrictEqual(
        getRegionEndpoints(regions, 'global'),
        GLOBAL_TODAY
      );
    });

    it('cn stays disabled and mirrors global under tellomi.cn (ADR-0065 §7)', () => {
      const regions = productionRegions();
      assert.isFalse(
        regions.cn.enabled,
        'cn is enabled only after the ICP filing'
      );

      const mirrored = JSON.parse(
        JSON.stringify(getRegionEndpoints(regions, 'global')).replaceAll(
          '.tellomi.app',
          '.tellomi.cn'
        )
      );
      assert.deepStrictEqual(getRegionEndpoints(regions, 'cn'), mirrored);

      // App filing lists every host the app connects to: not one may stay on tellomi.app.
      for (const value of strings(getRegionEndpoints(regions, 'cn'))) {
        assert.match(hostOf(value), /\.tellomi\.cn$/, value);
      }
    });

    it('no endpoint key stays at the top level next to regions', () => {
      const production = readConfig('production.json');
      for (const key of Object.keys(GLOBAL_TODAY)) {
        assert.notProperty(production, key);
      }
    });

    it('the effective production config uses the global region everywhere', () => {
      const merged = mergeDeep(
        readConfig('default.json'),
        readConfig('production.json')
      );
      const regions = parseRegions(merged.regions);
      const id = selectStartupRegion(regions);
      assert.strictEqual(id, 'global');

      applyRegionEndpoints(merged, getRegionEndpoints(regions, id));
      for (const [key, value] of Object.entries(GLOBAL_TODAY)) {
        assert.deepStrictEqual(merged[key], value, key);
      }
    });
  });

  describe('parseRegions', () => {
    // A fresh copy of production.json's regions whose global region the test edits.
    function productionCopy() {
      const raw = structuredClone(readConfig('production.json').regions) as {
        global: Record<string, unknown> & { cdn: Record<string, unknown> };
      };
      return { raw, global: raw.global };
    }

    // ADR-0065 P1-1b: one cdn3 host per region. Two would let a resumable upload change edges.
    it('rejects a second cdn3 host, as an array', () => {
      const { raw, global } = productionCopy();
      global.cdn['3'] = [
        'https://cdn3.tellomi.app',
        'https://cdn3b.tellomi.app',
      ];
      assert.throws(() => parseRegions(raw), /cdn/);
    });

    it('rejects a second cdn3 host, comma-joined', () => {
      const { raw, global } = productionCopy();
      global.cdn['3'] = 'https://cdn3.tellomi.app,https://cdn3b.tellomi.app';
      assert.throws(() => parseRegions(raw), /cdn/);
    });

    it('rejects an extra CDN number', () => {
      const { raw, global } = productionCopy();
      global.cdn['4'] = 'https://cdn4.tellomi.app';
      assert.throws(() => parseRegions(raw), /cdn/);
    });

    it('rejects a missing or unknown endpoint', () => {
      const missing = productionCopy();
      delete missing.global.storageUrl;
      assert.throws(() => parseRegions(missing.raw), /storageUrl/);

      const unknown = productionCopy();
      unknown.global.kvUrl = 'https://kv.tellomi.app';
      assert.throws(() => parseRegions(unknown.raw), /kvUrl/);
    });

    it('rejects plain http and a path on an origin', () => {
      const http = productionCopy();
      http.global.serverUrl = 'http://chat.tellomi.app';
      assert.throws(() => parseRegions(http.raw), /serverUrl/);

      const withPath = productionCopy();
      withPath.global.storageUrl = 'https://storage.tellomi.app/';
      assert.throws(() => parseRegions(withPath.raw), /storageUrl/);
    });

    it('rejects a disabled global region', () => {
      const { raw, global } = productionCopy();
      global.enabled = false;
      assert.throws(() => parseRegions(raw), /global region must stay enabled/);
    });
  });

  describe('selectStartupRegion / applyRegionEndpoints', () => {
    it('never starts in a disabled region', () => {
      const regions = productionRegions();
      assert.strictEqual(selectStartupRegion(regions, 'cn'), 'global');
      assert.strictEqual(selectStartupRegion(regions, 'mars'), 'global');
      assert.strictEqual(selectStartupRegion(regions), 'global');

      const cnEnabled = structuredClone(regions);
      cnEnabled.cn.enabled = true;
      assert.strictEqual(selectStartupRegion(cnEnabled, 'cn'), 'cn');
    });

    it('replaces cdn as a whole, so no default CDN number survives', () => {
      const target: Record<string, unknown> = {
        cdn: { '0': 'x', '1': 'left over', '2': 'x', '3': 'x' },
      };
      applyRegionEndpoints(
        target,
        getRegionEndpoints(productionRegions(), 'global')
      );
      assert.deepStrictEqual(target.cdn, GLOBAL_TODAY.cdn);
    });
  });

  describe('optional resources follow the region (build/optional-resources.json)', () => {
    it('every resource lives on the global resourcesUrl host, so rebasing is a no-op there', () => {
      const regions = productionRegions();
      const manifest = JSON.parse(
        readFileSync(
          join(CONFIG_DIR, '../build/optional-resources.json'),
          'utf8'
        )
      ) as Record<string, { url: string }>;
      const entries = Object.entries(manifest);
      assert.isAbove(entries.length, 0);

      const globalOrigin = new URL(regions.global.resourcesUrl).origin;
      for (const [name, { url }] of entries) {
        assert.strictEqual(new URL(url).origin, globalOrigin, name);
        assert.strictEqual(rebaseOrigin(url, regions.global.resourcesUrl), url);

        const moved = new URL(rebaseOrigin(url, regions.cn.resourcesUrl));
        assert.strictEqual(moved.host, 'updates.tellomi.cn', name);
        assert.strictEqual(moved.pathname, new URL(url).pathname, name);
      }
    });
  });

  describe('RegionSelector (ADR-0065 §6.5)', () => {
    function bothEnabled(): RegionsType {
      const regions = structuredClone(productionRegions());
      regions.cn.enabled = true;
      return regions;
    }

    function selector(
      regions: RegionsType,
      results: Partial<Record<RegionIdType, RegionProbeResultType>>,
      clock = { now: 0 },
      lastSwitchAt?: number
    ) {
      const probed: Array<RegionIdType> = [];
      const instance = new RegionSelector({
        regions,
        initial: 'global',
        now: () => clock.now,
        lastSwitchAt,
        probe: async id => {
          probed.push(id);
          const result = results[id];
          assert.isDefined(result, `unexpected probe of ${id}`);
          return result;
        },
      });
      return { instance, probed, clock };
    }

    it('probes only enabled regions', async () => {
      const regions = productionRegions();
      assert.deepStrictEqual(getEnabledRegions(regions), ['global']);

      const { instance, probed } = selector(regions, {
        global: { ok: true, rttMs: 40 },
      });
      const decision = await instance.probe();
      assert.deepStrictEqual(probed, ['global']);
      assert.deepStrictEqual([...decision.results.keys()], ['global']);
      assert.strictEqual(decision.recommended, 'global');
    });

    it('resolves no tellomi.cn name while cn is disabled', async () => {
      const looked: Array<string> = [];
      const lookup: LookupFunction = (hostname, _options, callback) => {
        looked.push(hostname);
        callback(new Error('offline in tests'), '', 4);
      };

      const instance = new RegionSelector({
        regions: productionRegions(),
        initial: 'global',
        probe: createChatProbe({ timeoutMs: 1000, lookup }),
      });
      const decision = await instance.probe();

      assert.deepStrictEqual(looked, ['chat.tellomi.app']);
      assert.isFalse(decision.results.get('global')?.ok);
      assert.strictEqual(decision.reason, 'no-alternative');
    });

    it('stays unless the other region is faster by the threshold', async () => {
      const { instance, clock } = selector(bothEnabled(), {
        global: { ok: true, rttMs: 100 },
        cn: {
          ok: true,
          rttMs: 100 - REGION_SELECTOR_DEFAULTS.latencyAdvantageMs,
        },
      });
      clock.now = 60 * MINUTE;
      assert.strictEqual((await instance.probe()).reason, 'stay');
    });

    it('lets the faster region win at once when no switch is on record', async () => {
      const { instance } = selector(bothEnabled(), {
        global: { ok: true, rttMs: 200 },
        cn: { ok: true, rttMs: 20 },
      });
      const cold = await instance.probe();
      assert.strictEqual(cold.reason, 'faster');
      assert.strictEqual(cold.recommended, 'cn');
    });

    it('holds a faster region back for the minimum dwell time', async () => {
      // Dwell counts from the last recorded switch (at t = 0), not from process start.
      const { instance, clock } = selector(
        bothEnabled(),
        {
          global: { ok: true, rttMs: 200 },
          cn: { ok: true, rttMs: 20 },
        },
        { now: 0 },
        0
      );

      clock.now = REGION_SELECTOR_DEFAULTS.minDwellMs - 1;
      const early = await instance.probe();
      assert.strictEqual(early.reason, 'dwell');
      assert.strictEqual(early.recommended, 'global');

      clock.now = REGION_SELECTOR_DEFAULTS.minDwellMs;
      const later = await instance.probe();
      assert.strictEqual(later.reason, 'faster');
      assert.strictEqual(later.recommended, 'cn');

      instance.switchTo('cn');
      assert.strictEqual(instance.currentRegion(), 'cn');

      // The switch itself restarts the dwell clock.
      const again = await instance.probe();
      assert.strictEqual(again.current, 'cn');
    });

    it('fails over only after consecutive failures', async () => {
      const { instance } = selector(bothEnabled(), {
        global: { ok: false, error: 'timeout' },
        cn: { ok: true, rttMs: 30 },
      });

      assert.strictEqual((await instance.probe()).reason, 'current-failing');
      assert.strictEqual((await instance.probe()).reason, 'current-failing');
      const third = await instance.probe();
      assert.strictEqual(third.reason, 'failover');
      assert.strictEqual(third.recommended, 'cn');
    });

    it('counts reported connection failures toward the failover', async () => {
      const { instance } = selector(bothEnabled(), {
        global: { ok: false, error: 'timeout' },
        cn: { ok: true, rttMs: 30 },
      });
      assert.isFalse(instance.reportConnectionFailure());
      assert.isFalse(instance.reportConnectionFailure());
      // The probe's own failure of the current region is the third one.
      assert.strictEqual((await instance.probe()).reason, 'failover');

      instance.reportConnectionSuccess();
      assert.isFalse(instance.reportConnectionFailure());
      assert.isFalse(instance.reportConnectionFailure());
      assert.isTrue(instance.reportConnectionFailure());
    });

    it('refuses a disabled region', () => {
      const regions = productionRegions();
      assert.throws(
        () =>
          new RegionSelector({
            regions,
            initial: 'cn',
            probe: async () => ({ ok: true, rttMs: 1 }),
          }),
        /disabled/
      );

      const { instance } = selector(regions, {});
      assert.throws(() => instance.switchTo('cn'), /disabled/);
      assert.strictEqual(instance.currentRegion(), 'global');
    });
  });
});
