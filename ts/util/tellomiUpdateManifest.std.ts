// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi（tellomi/tellomi#1399 Desktop 半边，需求 docs/product/specs/app-update-and-version-policy.md §3.2.1）：
// 更新清单 `update/v1/desktop-website.json` 的解析、采信和判档。只做纯计算：拉取、验签、缓存在
// `ts/updater/tellomiUpdateManifest.node.ts`，界面在渲染进程。和安卓 / iOS 同一套规则：
//   采信：签名对 → name / schema 对 → platform / channel 是自己 → serial ≥ 缓存里的；任何一条不过就当没拿到（照用缓存）。
//   判档：requiredMinBuild > build 且（没有 requiredFrom 或已到时间）→ 必须；否则还没到时间的必须、或 recommendedMinBuild > build → 推荐；
//         否则 latest.build > build → 可选；否则不提示。

import { DialogType } from '../types/Dialogs.std.ts';

const UPDATE_MANIFEST_NAME = 'tellomi-update';
const UPDATE_MANIFEST_SCHEMA = 1;
const UPDATE_MANIFEST_PLATFORM = 'desktop';
const UPDATE_MANIFEST_CHANNEL = 'website';
export const UPDATE_MANIFEST_PATH = 'update/v1/desktop-website.json';
// 清单很小（几百字节）；超过这个就不是我们的清单。
export const UPDATE_MANIFEST_MAX_BYTES = 64 * 1024;

export type UpdateTier = 'none' | 'optional' | 'recommended' | 'required';
export type RequiredReason = 'security' | 'protocol' | 'other';

export type UpdateManifest = Readonly<{
  serial: number;
  latest: Readonly<{
    version: string;
    build: number;
    releaseDate: string;
    url?: string;
  }>;
  recommendedMinBuild: number;
  requiredMinBuild: number;
  requiredReason?: RequiredReason;
  requiredFrom?: string;
  notesUrl?: string;
}>;

export type UpdateTierState = Readonly<{
  tier: UpdateTier;
  latestVersion?: string;
  latestBuild?: number;
  requiredReason?: RequiredReason;
  notesUrl?: string;
  downloadUrl?: string;
}>;

/**
 * Desktop 的构建号：Desktop 只有三段版本号，构建号由它算——主 × 1000000 + 次 × 1000 + 修订（0.1.12 → 1012）。
 * 和发版脚本 `scripts/release/update_manifest.py desktop_build` 同一个式子；预发布后缀（`-beta.1`）不影响。
 * 认不出来时返回 undefined（那就不判档、不提示）。
 */
export function desktopBuild(version: string): number | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (minor > 999 || patch > 999) {
    return undefined;
  }
  return major * 1_000_000 + minor * 1_000 + patch;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const RFC3339_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * 解析清单字节（签名已经验过）。字段不对、不是 Desktop 官网渠道的清单都返回 undefined——客户端只按字段读，未知字段忽略。
 */
export function parseUpdateManifest(
  bytes: Uint8Array<ArrayBuffer>
): UpdateManifest | undefined {
  if (bytes.length === 0 || bytes.length > UPDATE_MANIFEST_MAX_BYTES) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  if (
    m.name !== UPDATE_MANIFEST_NAME ||
    m.schema !== UPDATE_MANIFEST_SCHEMA ||
    m.platform !== UPDATE_MANIFEST_PLATFORM ||
    m.channel !== UPDATE_MANIFEST_CHANNEL
  ) {
    return undefined;
  }
  if (!isNonNegativeInteger(m.serial) || m.serial === 0) {
    return undefined;
  }
  const latest = m.latest as Record<string, unknown> | undefined;
  if (
    latest == null ||
    typeof latest !== 'object' ||
    typeof latest.version !== 'string' ||
    !isNonNegativeInteger(latest.build) ||
    typeof latest.releaseDate !== 'string'
  ) {
    return undefined;
  }
  if (
    !isNonNegativeInteger(m.recommendedMinBuild) ||
    !isNonNegativeInteger(m.requiredMinBuild)
  ) {
    return undefined;
  }
  let requiredReason: RequiredReason | undefined;
  if (m.requiredReason !== undefined) {
    if (
      m.requiredReason !== 'security' &&
      m.requiredReason !== 'protocol' &&
      m.requiredReason !== 'other'
    ) {
      return undefined;
    }
    requiredReason = m.requiredReason;
  }
  let requiredFrom: string | undefined;
  if (m.requiredFrom !== undefined) {
    if (typeof m.requiredFrom !== 'string' || !RFC3339_Z.test(m.requiredFrom)) {
      return undefined;
    }
    requiredFrom = m.requiredFrom;
  }
  return {
    serial: m.serial,
    latest: {
      version: latest.version,
      build: latest.build,
      releaseDate: latest.releaseDate,
      url: typeof latest.url === 'string' ? latest.url : undefined,
    },
    recommendedMinBuild: m.recommendedMinBuild,
    requiredMinBuild: m.requiredMinBuild,
    requiredReason,
    requiredFrom,
    notesUrl: typeof m.notesUrl === 'string' ? m.notesUrl : undefined,
  };
}

/** 只接受 serial ≥ 缓存里的：防止有人拿一份过期的真清单（比如已撤销的「必须」）重放。 */
export function isAcceptableSerial(
  candidate: UpdateManifest,
  cached: UpdateManifest | undefined
): boolean {
  return cached === undefined || candidate.serial >= cached.serial;
}

/** 判档（spec §3.2.1「判档」）。没有清单或认不出本机构建号时不提示。 */
export function evaluateUpdateTier(
  manifest: UpdateManifest | undefined,
  build: number | undefined,
  now: number
): UpdateTierState {
  if (manifest === undefined || build === undefined) {
    return { tier: 'none' };
  }
  const base = {
    latestVersion: manifest.latest.version,
    latestBuild: manifest.latest.build,
    notesUrl: manifest.notesUrl,
    downloadUrl: manifest.latest.url,
  };
  const requiredFrom =
    manifest.requiredFrom === undefined
      ? undefined
      : Date.parse(manifest.requiredFrom);
  if (manifest.requiredMinBuild > build) {
    if (
      requiredFrom === undefined ||
      Number.isNaN(requiredFrom) ||
      now >= requiredFrom
    ) {
      return {
        ...base,
        tier: 'required',
        requiredReason: manifest.requiredReason ?? 'other',
      };
    }
    return { ...base, tier: 'recommended' };
  }
  if (manifest.recommendedMinBuild > build) {
    return { ...base, tier: 'recommended' };
  }
  if (manifest.latest.build > build) {
    return { ...base, tier: 'optional' };
  }
  return { tier: 'none' };
}

/** 两次判档结果一样吗（主进程只在变了的时候通知窗口）。 */
export function isSameUpdateTierState(
  a: UpdateTierState,
  b: UpdateTierState
): boolean {
  return (
    a.tier === b.tier &&
    a.latestVersion === b.latestVersion &&
    a.latestBuild === b.latestBuild &&
    a.requiredReason === b.requiredReason &&
    a.notesUrl === b.notesUrl &&
    a.downloadUrl === b.downloadUrl
  );
}

/**
 * 推荐档的底部卡片：同一个版本只弹一次（spec §3.4「推荐更新」）。`seenVersion` = 上次弹过（点了「以后再说」或「立即更新」）的版本。
 * Desktop 的那条可关横幅沿用左栏现有的「有可用更新 · 点击重启」（更新器自己出，spec §3.4 最后一行），不另做。
 */
export function shouldShowRecommendedCard(
  state: UpdateTierState,
  seenVersion: string | undefined
): boolean {
  return (
    state.tier === 'recommended' &&
    state.latestVersion !== undefined &&
    state.latestVersion !== seenVersion
  );
}

/**
 * 必须档：选过「暂不更新，只看聊天记录」的同一个 App 版本不再自动弹阻断页（spec §3.4「时机」）；左栏红色横幅的「更新」随时能打开。
 * `chosenVersion` = 选只读时的 App 版本（tellomiUpdateReadOnlyChosenVersion）。
 */
export function shouldAutoShowRequiredLayer(
  state: UpdateTierState,
  chosenVersion: string | undefined,
  appVersion: string
): boolean {
  return state.tier === 'required' && chosenVersion !== appVersion;
}

/**
 * 阻断页现在该照哪一份状态画（spec §3.3「客户端收到 499 时显示的是同一个阻断页」）：
 * - 清单判了必须：照清单（原因、版本、说明链接）；
 * - 只有服务端 499：原因是「协议」那一句「此版本已无法与服务器正常通信」（同安卓 UpdateRequired.displayReason：清单没写原因的 499 = 协议），
 *   版本、说明和下载链接照最近一次判档（清单知道有新版本时才有）；
 * - 都没有：不显示。
 * `lastTier` = 主进程最近一次判档的结果（不管哪一档）。
 */
export function currentRequiredState(
  manifestRequired: UpdateTierState | undefined,
  serverRejected: boolean,
  lastTier: UpdateTierState | undefined
): UpdateTierState | undefined {
  if (manifestRequired !== undefined) {
    return manifestRequired;
  }
  if (!serverRejected) {
    return undefined;
  }
  return {
    tier: 'required',
    requiredReason: 'protocol',
    latestVersion: lastTier?.latestVersion,
    latestBuild: lastTier?.latestBuild,
    notesUrl: lastTier?.notesUrl,
    downloadUrl: lastTier?.downloadUrl,
  };
}

export type UpdateRequiredButtonState =
  | Readonly<{ kind: 'update' }>
  | Readonly<{ kind: 'restart' }>
  | Readonly<{ kind: 'downloading'; percent: number | undefined }>;

/**
 * 阻断页主按钮跟着自更新器（redux updates）走：下载好了 → 重启并更新；正在下载 → 下载中 x%（大小未知时不写数）；
 * 其余 → 立即更新（点了照 getBuildUpgradeAction：更新器手上有包就下载 / 安装，没有就打开下载页）。
 */
export function requiredButtonState(
  updates: Readonly<{
    dialogType: DialogType;
    downloadSize?: number;
    downloadedSize?: number;
  }>
): UpdateRequiredButtonState {
  if (
    updates.dialogType === DialogType.AutoUpdate ||
    updates.dialogType === DialogType.DownloadedUpdate
  ) {
    return { kind: 'restart' };
  }
  if (updates.dialogType === DialogType.Downloading) {
    const { downloadSize, downloadedSize } = updates;
    if (downloadSize === undefined || downloadSize <= 0) {
      return { kind: 'downloading', percent: undefined };
    }
    const percent = Math.floor(((downloadedSize ?? 0) * 100) / downloadSize);
    return {
      kind: 'downloading',
      percent: Math.min(100, Math.max(0, percent)),
    };
  }
  return { kind: 'update' };
}
