// Copyright 2026 Tellomi
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi (ADR-0065 §6.6, tellomi/tellomi#1054): "region -> one set of endpoints".
//
// Every endpoint the app talks to belongs to exactly one region, so a build can never end up
// half on our servers and half on someone else's (the shape of tellomi/tellomi#1023). The
// cross-platform contract - field meanings, the CN naming rule, selector thresholds - is
// tellomi/tellomi `docs/signal/REGION_PROFILE.md`; Android and iOS implement the same shape.
//
// Region ids are the lowercase strings ADR-0062 / ADR-0064 already use (`global` / `cn`).
// Until the CN ICP filing lands `cn.enabled` is false, and nothing may resolve or connect to a
// `*.tellomi.cn` host (ADR-0065 §7.2): a disabled region is never selected and never probed.

import lodash from 'lodash';
import { z } from 'zod';

import { MINUTE, SECOND } from './durations/index.std.ts';

const { omit } = lodash;

export const REGION_IDS = ['global', 'cn'] as const;
export type RegionIdType = (typeof REGION_IDS)[number];

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

// `https://host` exactly: no path, no trailing slash, no second URL glued on with a comma.
const originSchema = z
  .string()
  .refine(value => parseHttpsUrl(value)?.origin === value, {
    message: 'expected a bare https origin',
  });
const httpsUrlSchema = z
  .string()
  .refine(value => parseHttpsUrl(value) !== undefined, {
    message: 'expected an https URL',
  });
const hostnameSchema = z.string().regex(HOSTNAME, 'expected a bare hostname');

// The keys are the flat config keys the rest of the app already reads, so applying a region
// changes values only, never call sites.
const regionSchema = z
  .object({
    enabled: z.boolean(),
    serverUrl: originSchema,
    libsignalHostname: hostnameSchema,
    storageUrl: originSchema,
    // ADR-0065 §6.2 / P1-1b: exactly one host per CDN number. A resumable upload has to land
    // on the same edge from start to finish; "a spare cdn3" would silently move it mid-upload.
    cdn: z
      .object({ '0': originSchema, '2': originSchema, '3': originSchema })
      .strict(),
    sfuUrl: httpsUrlSchema,
    challengeUrl: httpsUrlSchema,
    registrationChallengeUrl: httpsUrlSchema,
    contentProxyUrl: httpsUrlSchema,
    updatesUrl: httpsUrlSchema,
    resourcesUrl: originSchema,
    outageCheckHost: hostnameSchema,
    debugLogUrl: httpsUrlSchema,
  })
  .strict();

const regionsSchema = z
  .object({ global: regionSchema, cn: regionSchema })
  .strict()
  .refine(regions => regions.global.enabled, {
    message: 'the global region must stay enabled',
  });

export type RegionType = z.infer<typeof regionSchema>;
export type RegionEndpointsType = Omit<RegionType, 'enabled'>;
export type RegionsType = z.infer<typeof regionsSchema>;

export function parseRegions(raw: unknown): RegionsType {
  const result = regionsSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid "regions" config:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data;
}

export function getEnabledRegions(regions: RegionsType): Array<RegionIdType> {
  return REGION_IDS.filter(id => regions[id].enabled);
}

export function getRegionEndpoints(
  regions: RegionsType,
  id: RegionIdType
): RegionEndpointsType {
  return omit(regions[id], 'enabled');
}

// The region to start in: the remembered one if it is still enabled, otherwise `global`.
// Nothing remembers a region yet - that arrives with runtime switching (ADR-0065 §6.5, M6).
export function selectStartupRegion(
  regions: RegionsType,
  remembered?: string
): RegionIdType {
  const id = REGION_IDS.find(candidate => candidate === remembered);
  return id !== undefined && regions[id].enabled ? id : 'global';
}

// Writes a region's endpoints over the flat keys (`serverUrl`, `cdn.3`, ...). app/config.main.ts
// calls this once, right after node-config loads and before its first `get()` freezes the object,
// so every reader - including ones a future upstream rebase adds - sees the region's values.
// `cdn` is replaced as a whole: no CDN number from default.json survives next to the region's.
export function applyRegionEndpoints(
  target: Record<string, unknown>,
  endpoints: RegionEndpointsType
): void {
  for (const [key, value] of Object.entries(endpoints)) {
    // Writing into the loaded config object is the whole point of this function.
    // oxlint-disable-next-line no-param-reassign
    target[key] = typeof value === 'object' ? { ...value } : value;
  }
}

// Points a URL at another host, keeping its path: the Desktop optional resources are declared
// with absolute URLs (build/optional-resources.json) and are fetched from the current region's
// `resourcesUrl` host instead.
export function rebaseOrigin(url: string, base: string): string {
  const target = new URL(url);
  const { protocol, host } = new URL(base);
  target.protocol = protocol;
  target.host = host;
  return target.toString();
}

// ---------------------------------------------------------------------------
// Region selection (ADR-0065 §6.5). The selector decides; the caller applies the decision
// (rebuilding libsignal's Net and the REST endpoints is the runtime-switching work in M6).

// Defaults are compiled in: fetching tuned values from /v2/config needs a connection first.
export const REGION_SELECTOR_DEFAULTS = {
  // No latency-driven switch within this long of the last region switch, as recorded by the
  // caller (`lastSwitchAt`). No record counts as satisfied, so on a cold start the faster region
  // wins (ADR-0065 §6.5). Also bounds how often a region switch rebuilds libsignal's Net, which
  // leaks its hostname each time (`custom_server_env` Box::leak, ADR-0065 §3.6).
  minDwellMs: 10 * MINUTE,
  // A single timeout never moves the user: only this many consecutive failures of the current
  // region allow a failover.
  failureThreshold: 3,
  // Another region must beat the current one by this much before a latency-driven switch.
  latencyAdvantageMs: 50,
  probeTimeoutMs: 5 * SECOND,
} as const;

export type RegionSelectorThresholdsType = {
  minDwellMs: number;
  failureThreshold: number;
  latencyAdvantageMs: number;
};

export type RegionProbeResultType = Readonly<
  { ok: true; rttMs: number } | { ok: false; error: string }
>;

// TCP + TLS handshake to the region's chat endpoint; needs no account, so it works before
// registration. Only ever called for enabled regions.
export type RegionProbeType = (
  id: RegionIdType,
  endpoints: RegionEndpointsType
) => Promise<RegionProbeResultType>;

export type RegionDecisionReasonType =
  | 'stay'
  | 'faster'
  | 'dwell'
  | 'failover'
  | 'current-failing'
  | 'no-alternative';

export type RegionDecisionType = Readonly<{
  current: RegionIdType;
  recommended: RegionIdType;
  reason: RegionDecisionReasonType;
  results: ReadonlyMap<RegionIdType, RegionProbeResultType>;
}>;

export class RegionSelector {
  readonly #regions: RegionsType;
  readonly #probe: RegionProbeType;
  readonly #now: () => number;
  readonly #thresholds: RegionSelectorThresholdsType;
  #current: RegionIdType;
  #since: number;
  #failures = 0;

  constructor({
    regions,
    initial,
    probe,
    now = Date.now,
    lastSwitchAt = Number.NEGATIVE_INFINITY,
    thresholds = REGION_SELECTOR_DEFAULTS,
  }: {
    regions: RegionsType;
    initial: RegionIdType;
    probe: RegionProbeType;
    now?: () => number;
    // When the region last changed (persisted by the caller); omitted = no record.
    lastSwitchAt?: number;
    thresholds?: RegionSelectorThresholdsType;
  }) {
    if (!regions[initial].enabled) {
      throw new Error(`RegionSelector: initial region ${initial} is disabled`);
    }
    this.#regions = regions;
    this.#probe = probe;
    this.#now = now;
    this.#thresholds = thresholds;
    this.#current = initial;
    this.#since = lastSwitchAt;
  }

  currentRegion(): RegionIdType {
    return this.#current;
  }

  // Call on every failed connection to the current region. `true` = time to probe
  // (ADR-0065 §6.5 trigger: N consecutive connection failures).
  reportConnectionFailure(): boolean {
    this.#failures += 1;
    return this.#failures >= this.#thresholds.failureThreshold;
  }

  reportConnectionSuccess(): void {
    this.#failures = 0;
  }

  // Probes every enabled region concurrently and recommends one. Disabled regions are skipped
  // before anything touches the network: no DNS query, no connection.
  async probe(): Promise<RegionDecisionType> {
    const ids = getEnabledRegions(this.#regions);
    const entries = await Promise.all(
      ids.map(async id => {
        let result: RegionProbeResultType;
        try {
          result = await this.#probe(id, getRegionEndpoints(this.#regions, id));
        } catch (error) {
          result = { ok: false, error: String(error) };
        }
        return [id, result] as const;
      })
    );
    const results: ReadonlyMap<RegionIdType, RegionProbeResultType> = new Map(
      entries
    );
    const current = this.#current;
    const decide = (
      recommended: RegionIdType,
      reason: RegionDecisionReasonType
    ): RegionDecisionType => ({ current, recommended, reason, results });

    let best: { id: RegionIdType; rttMs: number } | undefined;
    for (const [id, result] of results) {
      if (id !== current && result.ok && (!best || result.rttMs < best.rttMs)) {
        best = { id, rttMs: result.rttMs };
      }
    }

    const mine = results.get(current);
    if (!mine?.ok) {
      this.#failures += 1;
      if (!best) {
        return decide(current, 'no-alternative');
      }
      return this.#failures >= this.#thresholds.failureThreshold
        ? decide(best.id, 'failover')
        : decide(current, 'current-failing');
    }

    this.#failures = 0;
    if (
      !best ||
      best.rttMs + this.#thresholds.latencyAdvantageMs >= mine.rttMs
    ) {
      return decide(current, 'stay');
    }
    return this.#now() - this.#since >= this.#thresholds.minDwellMs
      ? decide(best.id, 'faster')
      : decide(current, 'dwell');
  }

  switchTo(id: RegionIdType): void {
    if (!this.#regions[id].enabled) {
      throw new Error(`RegionSelector: region ${id} is disabled`);
    }
    if (id !== this.#current) {
      this.#current = id;
      this.#since = this.#now();
    }
    this.#failures = 0;
  }
}
