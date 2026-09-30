// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '../logging/log.std.ts';
import { getLinkErrorKind } from './linkLog.std.ts';

const log = createLogger('linkRegistryStore');

// ADR-0063 §4.7 / §6.4 / §7.3, §8.1 rows 2–3: the hot-updated link registry. The bundled registry always exists; an
// update replaces it only when rust/links accepts it (`loadUpdate`: signature → name → schema → strictly newer →
// content rules). Anything else keeps what is in use, without an error and without a retry storm. Used by the
// renderer (classify) and the main process (open plan) alike, so both see the same registry.

/** The envelope schema this build reads (rust/links). Updates come as `links/s<N>/latest.json`. */
const SUPPORTED_LINK_REGISTRY_SCHEMA = 1;

/** Envelopes are ~100 KB; anything much bigger is not one. */
const MAX_LINK_REGISTRY_BYTES = 2 * 1024 * 1024;

/** Under the app's user data directory. */
export const LINK_REGISTRY_UPDATE_DIR = 'link-registry';

/**
 * Options for the main process' `net.fetch` of the registry pointer and envelope.
 *
 * `bypassCustomProtocolHandlers` is load-bearing: app/protocol_filter.node.ts installs a handler on the default
 * session that answers every http(s) request with ERR_ACCESS_DENIED (the renderer must not load web content), and
 * `net.fetch` goes through that session. Without this option the hot update can never download anything in a
 * packaged app (found on a real Electron 43.5 run, 2026-09-30, tellomi/tellomi#1421).
 */
export function linkRegistryFetchInit(timeoutMs: number): {
  bypassCustomProtocolHandlers: true;
  redirect: 'error';
  signal: AbortSignal;
} {
  return {
    bypassCustomProtocolHandlers: true,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  };
}

const KEEP_UPDATES = 2;
const ENVELOPE_FILE = /^links-(\d{1,12})\.json$/;

export type LinkRegistryLike = { readonly version: bigint };

export type LinkRegistryDeps<R extends LinkRegistryLike> = {
  load(envelope: Uint8Array<ArrayBuffer>): R;
  loadUpdate(
    envelope: Uint8Array<ArrayBuffer>,
    signatureHex: string,
    publicKey: Uint8Array<ArrayBuffer>,
    currentVersion: bigint | null
  ): R;
};

export type LoadedLinkRegistry<R extends LinkRegistryLike> = {
  registry: R;
  source: 'bundled' | 'update';
};

function envelopeName(version: number | bigint): string {
  return `links-${version}.json`;
}

function signatureName(version: number | bigint): string {
  return `links-${version}.sig`;
}

function toBytes(buffer: Buffer<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

function downloadedVersions(updateDir: string): Array<number> {
  if (!existsSync(updateDir)) {
    return [];
  }
  const versions = new Array<number>();
  for (const name of readdirSync(updateDir)) {
    const match = ENVELOPE_FILE.exec(name);
    if (match) {
      versions.push(Number(match[1]));
    }
  }
  return versions.sort((a, b) => b - a);
}

function removeUpdate(updateDir: string, version: number): void {
  rmSync(join(updateDir, envelopeName(version)), { force: true });
  rmSync(join(updateDir, signatureName(version)), { force: true });
}

/**
 * The bundled registry, or the newest downloaded one rust/links accepts on top of it. Throws only when the bundled
 * one cannot be loaded (the caller then shows previews the way Signal does).
 */
export function loadBestLinkRegistry<R extends LinkRegistryLike>({
  bundledPath,
  updateDir,
  publicKey,
  deps,
}: {
  bundledPath: string;
  updateDir: string;
  publicKey: Uint8Array<ArrayBuffer>;
  deps: LinkRegistryDeps<R>;
}): LoadedLinkRegistry<R> {
  const bundled = deps.load(toBytes(readFileSync(bundledPath)));

  for (const version of downloadedVersions(updateDir)) {
    try {
      const signaturePath = join(updateDir, signatureName(version));
      if (!existsSync(signaturePath)) {
        throw new Error('missing signature');
      }
      const registry = deps.loadUpdate(
        toBytes(readFileSync(join(updateDir, envelopeName(version)))),
        readFileSync(signaturePath, 'utf8').trim(),
        publicKey,
        bundled.version
      );
      return { registry, source: 'update' };
    } catch (error) {
      // Only what was downloaded is dropped; a rejected file would be rejected again on every start.
      log.warn(
        `dropping downloaded registry ${version}: ${getLinkErrorKind(error)}`
      );
      removeUpdate(updateDir, version);
    }
  }
  return { registry: bundled, source: 'bundled' };
}

/** Writes both files through a temporary name so a crash never leaves half an envelope; keeps the newest two. */
export function saveLinkRegistryUpdate(
  updateDir: string,
  version: number,
  envelope: Uint8Array<ArrayBuffer>,
  signatureHex: string
): void {
  mkdirSync(updateDir, { recursive: true });
  const write = (name: string, data: Uint8Array<ArrayBuffer> | string) => {
    const temporary = join(updateDir, `${name}.tmp`);
    writeFileSync(temporary, data);
    renameSync(temporary, join(updateDir, name));
  };
  write(envelopeName(version), envelope);
  write(signatureName(version), signatureHex);

  for (const old of downloadedVersions(updateDir).slice(KEEP_UPDATES)) {
    removeUpdate(updateDir, old);
  }
}

export type LinkRegistryPointer = {
  version: number;
  schema: number;
  url: string;
  sha256: string;
  sig: string;
};

/**
 * `links/s<N>/latest.json`: `{version, schema, url, sha256, sig}`. The envelope is only fetched from https on the
 * update host itself, with no credentials in the URL.
 */
export function parseLinkRegistryPointer(
  value: unknown,
  resourcesUrl: string,
  schema: number
): LinkRegistryPointer | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const {
    version,
    schema: pointerSchema,
    url,
    sha256,
    sig,
  } = value as Record<string, unknown>;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return undefined;
  }
  if (pointerSchema !== schema) {
    return undefined;
  }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
    return undefined;
  }
  if (typeof sig !== 'string' || !/^([0-9a-f]{2})+$/i.test(sig)) {
    return undefined;
  }
  if (typeof url !== 'string') {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const expected = new URL(resourcesUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== expected.origin ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { version, schema, url, sha256, sig };
}

export type LinkRegistryUpdateResult =
  | { status: 'updated'; version: bigint }
  | { status: 'current' }
  | { status: 'rejected' | 'failed'; reason: string };

/**
 * One check: ask for the pointer of the schema this build reads; when it is newer than [current], download the
 * envelope, check its hash, let rust/links accept or reject it, and only then store it. Never throws.
 */
export async function checkForLinkRegistryUpdate<R extends LinkRegistryLike>({
  resourcesUrl,
  schema = SUPPORTED_LINK_REGISTRY_SCHEMA,
  current,
  publicKey,
  updateDir,
  deps,
  fetchBytes,
}: {
  resourcesUrl: string;
  schema?: number;
  current: bigint;
  publicKey: Uint8Array<ArrayBuffer>;
  updateDir: string;
  deps: LinkRegistryDeps<R>;
  fetchBytes: (
    url: string,
    maxBytes: number
  ) => Promise<Uint8Array<ArrayBuffer>>;
}): Promise<LinkRegistryUpdateResult> {
  try {
    const base = resourcesUrl.replace(/\/+$/, '');
    const pointerBytes = await fetchBytes(
      `${base}/links/s${schema}/latest.json`,
      MAX_LINK_REGISTRY_BYTES
    );
    const pointer = parseLinkRegistryPointer(
      JSON.parse(new TextDecoder().decode(pointerBytes)),
      resourcesUrl,
      schema
    );
    if (!pointer) {
      return { status: 'failed', reason: 'pointer' };
    }
    if (BigInt(pointer.version) <= current) {
      return { status: 'current' };
    }

    const envelope = await fetchBytes(pointer.url, MAX_LINK_REGISTRY_BYTES);
    if (
      createHash('sha256').update(envelope).digest('hex') !==
      pointer.sha256.toLowerCase()
    ) {
      log.warn('downloaded registry does not match its hash');
      return { status: 'rejected', reason: 'hash' };
    }

    let registry: R;
    try {
      registry = deps.loadUpdate(
        new Uint8Array(envelope),
        pointer.sig,
        publicKey,
        current
      );
    } catch (error) {
      const reason = getLinkErrorKind(error);
      log.warn(`downloaded registry rejected: ${reason}`);
      return { status: 'rejected', reason };
    }

    saveLinkRegistryUpdate(updateDir, pointer.version, envelope, pointer.sig);
    log.info(`stored registry ${registry.version}`);
    return { status: 'updated', version: registry.version };
  } catch (error) {
    const reason = getLinkErrorKind(error);
    log.warn(`registry update check failed: ${reason}`);
    return { status: 'failed', reason };
  }
}
