// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi ships its own version line (0.x while in testing, 1.0.0 at launch) while the code base tracks an upstream
// Signal-Desktop release. Upstream's one-time upgrade migrations in background.preload.ts are keyed off *upstream*
// versions, so they must compare against the upstream base a build was made from, not against our own version —
// otherwise every 0.x → 0.y update would re-run every historical migration (erasing storage-service state, etc.).
//
// Bump TELLOMI_UPSTREAM_BASE whenever the fork is rebased onto a newer upstream release (docs/signal/VERSIONS.md).
export const TELLOMI_UPSTREAM_BASE = '8.29.0';

/** Tellomi versions are 0.x / 1.x / 2.x…; upstream Signal-Desktop versions have been ≥ 5.x since 2021. */
export function isTellomiVersion(version: string | undefined): boolean {
  if (!version) {
    return false;
  }
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0], 10);
  return Number.isFinite(major) && major < 5;
}
