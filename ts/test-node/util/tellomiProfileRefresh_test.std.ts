// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { DAY, HOUR, MINUTE } from '../../util/durations/index.std.ts';
import {
  routineRefreshMaxAge,
  shouldRefreshProfileOnMessage,
} from '../../util/tellomiProfileRefresh.std.ts';

// Tellomi (tellomi/tellomi#1366): refetch a contact's profile sooner so avatar and name changes show up.
describe('Tellomi profile refresh', () => {
  const now = 1_800_000_000_000;

  describe('shouldRefreshProfileOnMessage', () => {
    it('refetches when the profile was never fetched', () => {
      assert.isTrue(shouldRefreshProfileOnMessage(undefined, now));
      assert.isTrue(shouldRefreshProfileOnMessage(null, now));
    });

    it('refetches an hour after the last fetch, not before', () => {
      assert.isFalse(shouldRefreshProfileOnMessage(now - MINUTE, now));
      assert.isFalse(shouldRefreshProfileOnMessage(now - 59 * MINUTE, now));
      assert.isTrue(shouldRefreshProfileOnMessage(now - HOUR, now));
      assert.isTrue(shouldRefreshProfileOnMessage(now - DAY, now));
    });

    it('treats a fetch time in the future (clock went back) as due', () => {
      assert.isTrue(shouldRefreshProfileOnMessage(now + HOUR, now));
    });
  });

  describe('routineRefreshMaxAge', () => {
    const upstream = 3 * DAY;

    it('is 6 hours for conversations active in the last 30 days', () => {
      assert.strictEqual(routineRefreshMaxAge(now, now, upstream), 6 * HOUR);
      assert.strictEqual(
        routineRefreshMaxAge(now - 30 * DAY, now, upstream),
        6 * HOUR
      );
    });

    it('keeps upstream 3 days for older or unknown activity', () => {
      assert.strictEqual(
        routineRefreshMaxAge(now - 31 * DAY, now, upstream),
        upstream
      );
      assert.strictEqual(
        routineRefreshMaxAge(undefined, now, upstream),
        upstream
      );
    });

    it('never makes it longer than upstream', () => {
      assert.strictEqual(routineRefreshMaxAge(now, now, HOUR), HOUR);
    });
  });
});
