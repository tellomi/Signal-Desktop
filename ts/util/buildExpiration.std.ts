// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { Environment, getEnvironment } from '../environment.std.ts';
import type { LoggerType } from '../types/Logging.std.ts';
import { isInPast } from './timestamp.std.ts';
import { DAY } from './durations/index.std.ts';

// Tellomi (tellomi/tellomi#1269, spec #1143 §3.6): a build lives 180 days on every platform, whatever the
// auto-download setting (upstream: 90 days, cut to 30 when auto-download is off). The safety window sits one day
// above that; if it were shorter, a correct expiration would read as "set too far into the future" and the build
// would count as expired at once. scripts/get-expire-time.mjs writes the packaged expiration from the same number.
export const BUILD_LIFESPAN_DAYS = 180;
const SAFE_EXPIRATION_WINDOW = (BUILD_LIFESPAN_DAYS + 1) * DAY;

// Tellomi (#1269): the left pane warns during the last 14 days, like Android and iOS; upstream Desktop only says so
// after the fact (DialogExpiredBuild).
export const BUILD_EXPIRATION_WARNING_DAYS = 14;

export type GetBuildExpirationTimestampOptionsType = Readonly<{
  version: string;
  packagedBuildExpiration: number;
  remoteBuildExpiration: number | undefined;
  autoDownloadUpdate: boolean;
  logger: LoggerType;
}>;

export function getBuildExpirationTimestamp({
  packagedBuildExpiration,
  remoteBuildExpiration,
  logger,
}: GetBuildExpirationTimestampOptionsType): number {
  // Tellomi (#1269): no earlier expiry when auto-download is off (upstream took 60 days off); 180 days everywhere.
  // `version` and `autoDownloadUpdate` stay in the options type so the call sites match upstream.
  const localBuildExpiration = packagedBuildExpiration;

  // Log the expiration date in this selector because it invalidates only
  // if one of the arguments changes.
  let result: number;
  let type: string;
  if (remoteBuildExpiration && remoteBuildExpiration < localBuildExpiration) {
    type = 'remote';
    result = remoteBuildExpiration;
  } else {
    type = 'local';
    result = localBuildExpiration;
  }
  logger.info(`Build expires (${type}): ${new Date(result).toISOString()}`);
  return result;
}

export type HasBuildExpiredOptionsType = Readonly<{
  buildExpirationTimestamp: number;
  autoDownloadUpdate: boolean;
  now: number;
  logger: LoggerType;
}>;

export function hasBuildExpired({
  buildExpirationTimestamp,
  now,
  logger,
}: HasBuildExpiredOptionsType): boolean {
  if (
    getEnvironment() !== Environment.PackagedApp &&
    buildExpirationTimestamp === 0
  ) {
    return false;
  }

  if (isInPast(buildExpirationTimestamp)) {
    return true;
  }

  // Tellomi (#1269): one window for both auto-download settings, just above BUILD_LIFESPAN_DAYS.
  const safeExpirationMs = SAFE_EXPIRATION_WINDOW;

  const buildExpirationDuration = buildExpirationTimestamp - now;
  const tooFarIntoFuture = buildExpirationDuration > safeExpirationMs;

  if (tooFarIntoFuture) {
    logger.error(
      'Build expiration is set too far into the future',
      buildExpirationTimestamp
    );
  }

  return tooFarIntoFuture || isInPast(buildExpirationTimestamp);
}

// Tellomi (#1269): days left to show in the left-pane "expires soon" warning. Undefined outside the last
// BUILD_EXPIRATION_WARNING_DAYS days, for dev builds without an expiration (0), and once expired, when
// DialogExpiredBuild takes over. Rounded up, so the warning appears when exactly 14 days are left and says "1 day" on
// the last day rather than "0 days".
export function getBuildExpirationWarningDays({
  buildExpirationTimestamp,
  now,
}: Readonly<{ buildExpirationTimestamp: number; now: number }>):
  | number
  | undefined {
  if (buildExpirationTimestamp === 0) {
    return undefined;
  }
  const msLeft = buildExpirationTimestamp - now;
  if (msLeft <= 0 || msLeft > BUILD_EXPIRATION_WARNING_DAYS * DAY) {
    return undefined;
  }
  return Math.ceil(msLeft / DAY);
}
