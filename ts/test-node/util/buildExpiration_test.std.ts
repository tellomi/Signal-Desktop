// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { createLogger } from '../../logging/log.std.ts';
import { DAY } from '../../util/durations/index.std.ts';
import {
  BUILD_EXPIRATION_WARNING_DAYS,
  BUILD_LIFESPAN_DAYS,
  getBuildExpirationTimestamp,
  getBuildExpirationWarningDays,
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
});
