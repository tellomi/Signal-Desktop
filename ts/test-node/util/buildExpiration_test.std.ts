// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { createLogger } from '../../logging/log.std.ts';
import { DialogType } from '../../types/Dialogs.std.ts';
import { DAY } from '../../util/durations/index.std.ts';
import type { BuildUpgradeActionType } from '../../util/buildExpiration.std.ts';
import {
  BUILD_EXPIRATION_WARNING_DAYS,
  BUILD_LIFESPAN_DAYS,
  getBuildExpirationTimestamp,
  getBuildExpirationWarningDays,
  getBuildUpgradeAction,
  hasBuildExpired,
} from '../../util/buildExpiration.std.ts';

// Tellomi (tellomi/tellomi#1269, spec #1143 §3.6): builds live 180 days on every platform, whatever the auto-download
// setting, and the left pane warns during the last 14 days.
describe('buildExpiration (Tellomi: 180 days, 14-day warning)', () => {
  const logger = createLogger('buildExpiration_test');

  describe('getBuildExpirationTimestamp', () => {
    it('keeps the packaged expiration with auto-download on or off', () => {
      const packagedBuildExpiration = Date.now() + BUILD_LIFESPAN_DAYS * DAY;
      for (const autoDownloadUpdate of [true, false]) {
        assert.strictEqual(
          getBuildExpirationTimestamp({
            version: '0.1.2',
            packagedBuildExpiration,
            remoteBuildExpiration: undefined,
            autoDownloadUpdate,
            logger,
          }),
          packagedBuildExpiration,
          `autoDownloadUpdate=${autoDownloadUpdate}`
        );
      }
    });

    it('still lets an earlier remote expiration win', () => {
      const now = Date.now();
      assert.strictEqual(
        getBuildExpirationTimestamp({
          version: '0.1.2',
          packagedBuildExpiration: now + BUILD_LIFESPAN_DAYS * DAY,
          remoteBuildExpiration: now + 10 * DAY,
          autoDownloadUpdate: true,
          logger,
        }),
        now + 10 * DAY
      );
    });
  });

  describe('hasBuildExpired', () => {
    it('does not expire a fresh 180-day build, with auto-download on or off', () => {
      const now = Date.now();
      for (const autoDownloadUpdate of [true, false]) {
        assert.isFalse(
          hasBuildExpired({
            buildExpirationTimestamp: now + BUILD_LIFESPAN_DAYS * DAY,
            autoDownloadUpdate,
            now,
            logger,
          }),
          `autoDownloadUpdate=${autoDownloadUpdate}`
        );
      }
    });

    it('still treats an expiration set too far into the future as expired', () => {
      const now = Date.now();
      assert.isTrue(
        hasBuildExpired({
          buildExpirationTimestamp: now + (BUILD_LIFESPAN_DAYS + 2) * DAY,
          autoDownloadUpdate: true,
          now,
          logger,
        })
      );
    });

    it('treats a past expiration as expired', () => {
      const now = Date.now();
      assert.isTrue(
        hasBuildExpired({
          buildExpirationTimestamp: now - 1000,
          autoDownloadUpdate: true,
          now,
          logger,
        })
      );
    });
  });

  describe('getBuildExpirationWarningDays', () => {
    const now = 1_700_000_000_000;
    const daysLeftAt = (msLeft: number) =>
      getBuildExpirationWarningDays({
        buildExpirationTimestamp: now + msLeft,
        now,
      });

    it('stays quiet before the last 14 days', () => {
      assert.isUndefined(daysLeftAt(BUILD_EXPIRATION_WARNING_DAYS * DAY + 1));
      assert.isUndefined(daysLeftAt(30 * DAY));
    });

    it('counts the days left, rounded up, inside the window', () => {
      assert.strictEqual(daysLeftAt(14 * DAY), 14);
      assert.strictEqual(daysLeftAt(13.5 * DAY), 14);
      assert.strictEqual(daysLeftAt(DAY), 1);
      assert.strictEqual(daysLeftAt(1), 1);
    });

    it('hands over to the expired dialog, and ignores dev builds', () => {
      assert.isUndefined(daysLeftAt(0));
      assert.isUndefined(daysLeftAt(-DAY));
      assert.isUndefined(
        getBuildExpirationWarningDays({ buildExpirationTimestamp: 0, now })
      );
    });
  });

  // Tellomi（#1269）：两条提示的按钮——更新器手上有能下载 / 安装 / 重试的版本（主进程登记了 'start-update'）才走
  // 更新器，正在下载时不放按钮，其余打开下载页。Record 列全所有 DialogType：上游加了新状态，这里编译不过，逼人想一遍。
  describe('getBuildUpgradeAction', () => {
    const expected: Record<DialogType, BuildUpgradeActionType> = {
      [DialogType.None]: 'download-page',
      [DialogType.AutoUpdate]: 'updater',
      [DialogType.DownloadedUpdate]: 'updater',
      [DialogType.DownloadReady]: 'updater',
      [DialogType.FullDownloadReady]: 'updater',
      [DialogType.Cannot_Update]: 'updater',
      [DialogType.Downloading]: 'none',
      [DialogType.Cannot_Update_Require_Manual]: 'download-page',
      [DialogType.MacOS_Read_Only]: 'download-page',
      [DialogType.UnsupportedOS]: 'download-page',
      [DialogType.MASUpdate]: 'download-page',
    };

    it('uses the updater only while it has an update to act on', () => {
      for (const updateDialogType of Object.values(DialogType)) {
        assert.strictEqual(
          getBuildUpgradeAction({
            isMAS: false,
            updateDialogType,
            didSnoozeUpdate: false,
          }),
          expected[updateDialogType],
          updateDialogType
        );
      }
    });

    it('still uses the updater after the update dialog was snoozed', () => {
      assert.strictEqual(
        getBuildUpgradeAction({
          isMAS: false,
          updateDialogType: DialogType.None,
          didSnoozeUpdate: true,
        }),
        'updater'
      );
    });

    it('never uses the updater on the Mac App Store build', () => {
      for (const updateDialogType of Object.values(DialogType)) {
        for (const didSnoozeUpdate of [false, true]) {
          assert.strictEqual(
            getBuildUpgradeAction({
              isMAS: true,
              updateDialogType,
              didSnoozeUpdate,
            }),
            'download-page',
            `${updateDialogType} didSnoozeUpdate=${didSnoozeUpdate}`
          );
        }
      }
    });
  });
});
