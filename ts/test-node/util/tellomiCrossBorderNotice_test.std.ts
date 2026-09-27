// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  TELLOMI_CROSS_BORDER_NOTICE_VERSION,
  createTellomiCrossBorderNoticeGate,
  createTellomiNetworkLatch,
  isTellomiCrossBorderNoticeAcknowledged,
} from '../../util/tellomiCrossBorderNotice.std.ts';
import { explodePromise } from '../../util/explodePromise.std.ts';

// Tellomi（tellomi/tellomi#1338）：Desktop 的跨境告知只读版——本机没记下 cb-1 就先出告知，点「知道了」之后才记版本、才放开联网。
describe('tellomiCrossBorderNotice (tellomi/tellomi#1338)', () => {
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  }

  function createHarness({
    stored,
    skip = false,
    failStore = false,
  }: {
    stored: string | undefined;
    skip?: boolean;
    failStore?: boolean;
  }) {
    const events: Array<string> = [];
    let storedVersion = stored;
    let notice = explodePromise<void>();
    let showCount = 0;

    const gate = createTellomiCrossBorderNoticeGate({
      shouldSkip: () => skip,
      getStoredVersion: () => storedVersion,
      storeVersion: async version => {
        events.push(`store:${version}`);
        if (failStore) {
          throw new Error('disk full');
        }
        storedVersion = version;
      },
      showNotice: async () => {
        showCount += 1;
        events.push('show');
        await notice.promise;
        events.push('acknowledged');
      },
      onNetworkAllowed: () => {
        events.push('network');
      },
    });

    return {
      gate,
      events,
      acknowledge: () => notice.resolve(),
      resetNotice: () => {
        notice = explodePromise<void>();
      },
      removeStored: () => {
        storedVersion = undefined;
      },
      getStored: () => storedVersion,
      getShowCount: () => showCount,
    };
  }

  it('pins the notice version to cb-1 (spec §6.1 ①)', () => {
    assert.strictEqual(TELLOMI_CROSS_BORDER_NOTICE_VERSION, 'cb-1');
  });

  describe('isTellomiCrossBorderNoticeAcknowledged', () => {
    it('is true only for the current version', () => {
      assert.isTrue(isTellomiCrossBorderNoticeAcknowledged('cb-1'));
      for (const value of [
        undefined,
        null,
        '',
        'cb-0',
        'cb-2',
        'CB-1',
        ' cb-1',
        '0.1.0-draft',
        '2.0.0',
        1,
        true,
      ]) {
        assert.isFalse(
          isTellomiCrossBorderNoticeAcknowledged(value),
          String(value)
        );
      }
    });
  });

  describe('ensureAcknowledged', () => {
    it('new install: shows the notice, and neither stores nor allows network until acknowledged', async () => {
      const h = createHarness({ stored: undefined });
      let resolved = false;
      const done = (async () => {
        await h.gate.ensureAcknowledged();
        resolved = true;
      })();

      await flush();
      assert.deepStrictEqual(h.events, ['show']);
      assert.isFalse(resolved);
      assert.isFalse(h.gate.isNetworkAllowed());

      h.acknowledge();
      await done;

      assert.deepStrictEqual(h.events, [
        'show',
        'acknowledged',
        'store:cb-1',
        'network',
      ]);
      assert.strictEqual(h.getStored(), 'cb-1');
      assert.isTrue(h.gate.isNetworkAllowed());
    });

    it('upgrade from an older notice version shows it again', async () => {
      const h = createHarness({ stored: 'cb-0' });
      const done = h.gate.ensureAcknowledged();
      await flush();
      assert.strictEqual(h.getShowCount(), 1);
      h.acknowledge();
      await done;
      assert.strictEqual(h.getStored(), 'cb-1');
    });

    it('already acknowledged: no notice, no write, network allowed once', async () => {
      const h = createHarness({ stored: 'cb-1' });
      await h.gate.ensureAcknowledged();
      await h.gate.ensureAcknowledged();
      assert.deepStrictEqual(h.events, ['network']);
      assert.strictEqual(h.getShowCount(), 0);
    });

    it('concurrent callers (startup + "set up as new device") share one notice', async () => {
      const h = createHarness({ stored: undefined });
      const first = h.gate.ensureAcknowledged();
      const second = h.gate.ensureAcknowledged();
      await flush();
      assert.strictEqual(h.getShowCount(), 1);

      h.acknowledge();
      await Promise.all([first, second]);
      assert.deepStrictEqual(h.events, [
        'show',
        'acknowledged',
        'store:cb-1',
        'network',
      ]);
    });

    it('after unlink removed the stored version, relinking shows it again without re-allowing network', async () => {
      const h = createHarness({ stored: undefined });
      const first = h.gate.ensureAcknowledged();
      h.acknowledge();
      await first;

      h.removeStored();
      h.resetNotice();
      const second = h.gate.ensureAcknowledged();
      await flush();
      assert.strictEqual(h.getShowCount(), 2);

      h.acknowledge();
      await second;
      assert.deepStrictEqual(h.events, [
        'show',
        'acknowledged',
        'store:cb-1',
        'network',
        'show',
        'acknowledged',
        'store:cb-1',
      ]);
    });

    it('a failed write still lets the acknowledged session continue', async () => {
      const h = createHarness({ stored: undefined, failStore: true });
      const done = h.gate.ensureAcknowledged();
      h.acknowledge();
      await done;
      assert.isTrue(h.gate.isNetworkAllowed());
      assert.isUndefined(h.getStored());
    });

    it('is skipped in test / mock environments', async () => {
      const h = createHarness({ stored: undefined, skip: true });
      await h.gate.ensureAcknowledged();
      assert.deepStrictEqual(h.events, ['network']);
    });
  });

  describe('allowNetworkIfAcknowledged (early preconnect / main-process gate)', () => {
    it('allows network early only when this device already acknowledged cb-1', () => {
      const notAcknowledged = createHarness({ stored: undefined });
      assert.isFalse(
        notAcknowledged.gate.allowNetworkIfAcknowledged(undefined)
      );
      assert.isFalse(notAcknowledged.gate.allowNetworkIfAcknowledged('cb-0'));
      assert.deepStrictEqual(notAcknowledged.events, []);

      const acknowledged = createHarness({ stored: 'cb-1' });
      assert.isTrue(acknowledged.gate.allowNetworkIfAcknowledged('cb-1'));
      assert.isTrue(acknowledged.gate.allowNetworkIfAcknowledged('cb-1'));
      assert.deepStrictEqual(acknowledged.events, ['network']);
    });

    it('is skipped in test / mock environments', () => {
      const h = createHarness({ stored: undefined, skip: true });
      assert.isTrue(h.gate.allowNetworkIfAcknowledged(undefined));
      assert.deepStrictEqual(h.events, ['network']);
    });
  });

  describe('createTellomiNetworkLatch (main process)', () => {
    it('holds waiters until opened, then lets everyone through', async () => {
      const latch = createTellomiNetworkLatch();
      let passed = 0;
      const waiters = [latch.wait(), latch.wait()].map(async p => {
        await p;
        passed += 1;
      });

      await flush();
      assert.isFalse(latch.isOpen());
      assert.strictEqual(passed, 0);

      latch.open();
      latch.open();
      await Promise.all(waiters);
      assert.isTrue(latch.isOpen());
      assert.strictEqual(passed, 2);

      await latch.wait();
    });
  });
});
