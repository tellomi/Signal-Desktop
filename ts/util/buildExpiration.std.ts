// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { Environment, getEnvironment } from '../environment.std.ts';
import { DialogType } from '../types/Dialogs.std.ts';
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

// Tellomi（#1269）：「即将过期」「已过期」两条左栏提示的按钮怎么升级。
// - 'updater'：做的和更新提示（DialogUpdate）的按钮一样，startUpdate。只在更新器已经把一个可以下载 / 安装 / 重试的
//   版本报给界面时才这样走：只有这时主进程登记了 'start-update' 的处理函数；没登记时 startUpdate 只会弹「无法更新」。
//   更新器没开或没在跑（开发版、adhoc 版、updatesEnabled=false）就不会报任何状态，自然落到下载页。
// - 'download-page'：打开 tellomi.app/download（DialogExpiredBuild 在 MAS 上照上游去 App Store；Tellomi 没有 MAS 版）。
//   更新器手上没东西时（还没查到新版本、服务器上没有更新的、自动下载还在后台进行）也走这里：不用 forceUpdate，
//   因为它不比版本号，服务器上只有同一版时会重下一遍再重启。
// - 'none'：更新正在下载，左栏下面的更新提示有进度条，此刻主进程也没有处理函数，按钮先不放。
export type BuildUpgradeActionType = 'updater' | 'download-page' | 'none';

const UPDATER_DIALOG_TYPES: ReadonlySet<DialogType> = new Set([
  DialogType.AutoUpdate, // 已下载好（Linux deb：apt 已装好新版），重启即完成
  DialogType.DownloadedUpdate, // 手动下载完，重启安装
  DialogType.DownloadReady, // 关了自动下载：开始下载
  DialogType.FullDownloadReady, // 差分下载失败：下载完整包
  DialogType.Cannot_Update, // 出错后重试（同 DialogUpdate 里的「重试更新」）
]);

export function getBuildUpgradeAction({
  isMAS,
  updateDialogType,
  didSnoozeUpdate,
}: Readonly<{
  isMAS: boolean;
  updateDialogType: DialogType;
  didSnoozeUpdate: boolean;
}>): BuildUpgradeActionType {
  if (isMAS) {
    return 'download-page';
  }
  if (UPDATER_DIALOG_TYPES.has(updateDialogType)) {
    return 'updater';
  }
  // 点过更新提示的 ×（snoozeUpdate）：界面上的状态回到 None，主进程的处理函数还在。
  if (updateDialogType === DialogType.None && didSnoozeUpdate) {
    return 'updater';
  }
  if (updateDialogType === DialogType.Downloading) {
    return 'none';
  }
  return 'download-page';
}
