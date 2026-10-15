// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi（tellomi/tellomi#1399 Desktop 半边）：拉更新清单 `update/v1/desktop-website.json` + `.sig`，验签（XEdDSA，
// 公钥 = config 的 updatesPublicKey，签的是清单文件的原始字节）、解析、只接受 serial ≥ 缓存的，存成新缓存。
// 什么都不抛：拉不到、验不过、比缓存旧，都照用缓存（spec §3.2「客户端采信」）。主进程的调度在 app/tellomiUpdateManifest.main.ts。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  isAcceptableSerial,
  parseUpdateManifest,
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_MANIFEST_PATH,
} from '../util/tellomiUpdateManifest.std.ts';
import type { UpdateManifest } from '../util/tellomiUpdateManifest.std.ts';

export const UPDATE_MANIFEST_CACHE_DIR = 'tellomi-update-manifest';
const CACHE_FILE = 'desktop-website.json';
const SIGNATURE_FILE = `${CACHE_FILE}.sig`;
const SIGNATURE_MAX_BYTES = 1024;

export type UpdateManifestDeps = Readonly<{
  fetchBytes: (
    url: string,
    maxBytes: number
  ) => Promise<Uint8Array<ArrayBuffer>>;
  verify: (
    publicKey: Uint8Array<ArrayBuffer>,
    message: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer>
  ) => boolean;
}>;

export type UpdateManifestCheckResult = Readonly<{
  status: 'updated' | 'current' | 'rejected' | 'failed';
  // 检查之后该用的清单：新的，或者照用的缓存。
  manifest: UpdateManifest | undefined;
}>;

/**
 * 清单地址：和自更新的 `updatesUrl`（…/desktop）同一个更新源的 `update/v1/desktop-website.json`。
 */
export function updateManifestUrl(updatesUrl: string): string {
  const base = updatesUrl.endsWith('/') ? updatesUrl : `${updatesUrl}/`;
  return new URL(`../${UPDATE_MANIFEST_PATH}`, base).toString();
}

function decodeSignature(
  bytes: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> | undefined {
  const hex = new TextDecoder().decode(bytes).trim();
  if (!/^[0-9a-f]{128}$/i.test(hex)) {
    return undefined;
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function verifiedManifest(
  bytes: Uint8Array<ArrayBuffer>,
  signatureFile: Uint8Array<ArrayBuffer>,
  publicKey: Uint8Array<ArrayBuffer>,
  verify: UpdateManifestDeps['verify']
): UpdateManifest | undefined {
  const signature = decodeSignature(signatureFile);
  if (signature === undefined) {
    return undefined;
  }
  let ok = false;
  try {
    ok = verify(publicKey, bytes, signature);
  } catch {
    ok = false;
  }
  return ok ? parseUpdateManifest(bytes) : undefined;
}

/** 读缓存，并且每次都重新验签（缓存文件可能被别的东西改过）。 */
export function loadCachedUpdateManifest(options: {
  cacheDir: string;
  publicKey: Uint8Array<ArrayBuffer>;
  verify: UpdateManifestDeps['verify'];
}): UpdateManifest | undefined {
  const manifestPath = join(options.cacheDir, CACHE_FILE);
  const signaturePath = join(options.cacheDir, SIGNATURE_FILE);
  if (!existsSync(manifestPath) || !existsSync(signaturePath)) {
    return undefined;
  }
  try {
    return verifiedManifest(
      new Uint8Array(readFileSync(manifestPath)),
      new Uint8Array(readFileSync(signaturePath)),
      options.publicKey,
      options.verify
    );
  } catch {
    return undefined;
  }
}

function writeAtomically(path: string, data: Uint8Array<ArrayBuffer>): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}

export async function checkForUpdateManifest(options: {
  updatesUrl: string;
  cacheDir: string;
  publicKey: Uint8Array<ArrayBuffer>;
  deps: UpdateManifestDeps;
}): Promise<UpdateManifestCheckResult> {
  const { cacheDir, publicKey, deps } = options;
  const cached = loadCachedUpdateManifest({
    cacheDir,
    publicKey,
    verify: deps.verify,
  });
  const url = updateManifestUrl(options.updatesUrl);

  let bytes: Uint8Array<ArrayBuffer>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    bytes = await deps.fetchBytes(url, UPDATE_MANIFEST_MAX_BYTES);
    signature = await deps.fetchBytes(`${url}.sig`, SIGNATURE_MAX_BYTES);
  } catch {
    return { status: 'failed', manifest: cached };
  }

  const candidate = verifiedManifest(bytes, signature, publicKey, deps.verify);
  if (candidate === undefined || !isAcceptableSerial(candidate, cached)) {
    return { status: 'rejected', manifest: cached };
  }
  if (cached !== undefined && candidate.serial === cached.serial) {
    return { status: 'current', manifest: cached };
  }

  try {
    mkdirSync(cacheDir, { recursive: true });
    // 签名先、清单后：中途断了，下次读缓存时验不过就当没有，不会拿新签名配旧清单。
    writeAtomically(join(cacheDir, SIGNATURE_FILE), signature);
    writeAtomically(join(cacheDir, CACHE_FILE), bytes);
  } catch {
    // 存不下也照用这一份（下次启动再拉）。
  }
  return { status: 'updated', manifest: candidate };
}
