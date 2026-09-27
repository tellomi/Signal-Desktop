// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type {
  TellomiLogoutKeepHistoryDeps,
  TellomiLogoutKeepHistoryResult,
} from '../../util/tellomiLogoutKeepHistory.std.ts';
import { tellomiLogoutKeepHistory } from '../../util/tellomiLogoutKeepHistory.std.ts';
import { explodePromise } from '../../util/explodePromise.std.ts';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4）：Desktop 的「退出登录（保留聊天记录）」=
// 已链接设备调 DELETE /v1/devices/{本机 id} 删掉自己，成功后马上走现有的 unlinkAndDisconnect
// （不等之后的 403），进入「未连接……重新关联」状态、会话保留；没网或失败就提示「退出登录需要联网」、
// 什么都不改。
describe('tellomiLogoutKeepHistory (tellomi/tellomi#1414, ADR-0072 §4.4)', () => {
  type Call =
    | { name: 'removeOurDevice'; deviceId: number }
    | { name: 'removeOurDevice:settled' }
    | { name: 'unlinkAndDisconnect' }
    | { name: 'showNeedsNetwork' };

  function setup(
    overrides: Partial<{
      deviceId: number | undefined;
      isConnected: boolean;
      removeOurDevice: (deviceId: number) => Promise<void>;
    }> = {}
  ): { deps: TellomiLogoutKeepHistoryDeps; calls: Array<Call> } {
    const calls: Array<Call> = [];
    const deviceId = 'deviceId' in overrides ? overrides.deviceId : 3;
    const deps: TellomiLogoutKeepHistoryDeps = {
      getOurDeviceId: () => deviceId,
      isConnected: () => overrides.isConnected ?? true,
      removeOurDevice: async id => {
        calls.push({ name: 'removeOurDevice', deviceId: id });
        try {
          await overrides.removeOurDevice?.(id);
        } finally {
          calls.push({ name: 'removeOurDevice:settled' });
        }
      },
      unlinkAndDisconnect: async () => {
        calls.push({ name: 'unlinkAndDisconnect' });
      },
      showNeedsNetwork: () => {
        calls.push({ name: 'showNeedsNetwork' });
      },
    };
    return { deps, calls };
  }

  function makeHttpError(code: number): Error {
    return Object.assign(new Error(`HTTP ${code}`), {
      name: 'HTTPError',
      code,
    });
  }

  describe('the server call', () => {
    it('removes this device (and only this device) by its own id', async () => {
      const { deps, calls } = setup({ deviceId: 3 });
      await tellomiLogoutKeepHistory(deps);

      const removals = calls.filter(call => call.name === 'removeOurDevice');
      assert.deepStrictEqual(removals, [
        { name: 'removeOurDevice', deviceId: 3 },
      ]);
    });

    it('uses whatever id this device was linked as', async () => {
      const { deps, calls } = setup({ deviceId: 7 });
      await tellomiLogoutKeepHistory(deps);

      assert.deepInclude(calls, { name: 'removeOurDevice', deviceId: 7 });
    });

    it('never asks the server to remove the primary device (id 1)', async () => {
      const { deps, calls } = setup({ deviceId: 1 });
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual(result, 'not-a-linked-device');
      assert.deepStrictEqual(calls, []);
    });

    it('does nothing when this device has no id (never linked)', async () => {
      const { deps, calls } = setup({ deviceId: undefined });
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual(result, 'not-a-linked-device');
      assert.deepStrictEqual(calls, []);
    });
  });

  describe('success', () => {
    it('enters the existing unlinked state right after the server removed the device', async () => {
      const { deps, calls } = setup();
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual<TellomiLogoutKeepHistoryResult>(result, 'logged-out');
      assert.deepStrictEqual(calls, [
        { name: 'removeOurDevice', deviceId: 3 },
        { name: 'removeOurDevice:settled' },
        { name: 'unlinkAndDisconnect' },
      ]);
    });

    it('does not start unlinking before the server has answered', async () => {
      const { promise, resolve } = explodePromise<void>();
      const { deps, calls } = setup({ removeOurDevice: () => promise });

      const pending = tellomiLogoutKeepHistory(deps);
      await Promise.resolve();
      assert.notDeepInclude(calls, { name: 'unlinkAndDisconnect' });

      resolve();
      assert.strictEqual(await pending, 'logged-out');
      assert.deepInclude(calls, { name: 'unlinkAndDisconnect' });
    });

    it('waits for the unlinked state to be reached before resolving', async () => {
      const { promise, resolve } = explodePromise<void>();
      const { deps } = setup();
      let settled = false;

      const pending = (async () => {
        const result = await tellomiLogoutKeepHistory({
          ...deps,
          unlinkAndDisconnect: () => promise,
        });
        settled = true;
        return result;
      })();

      await new Promise(done => {
        setTimeout(done, 0);
      });
      assert.isFalse(settled);

      resolve();
      assert.strictEqual(await pending, 'logged-out');
    });

    it('shows no error', async () => {
      const { deps, calls } = setup();
      await tellomiLogoutKeepHistory(deps);

      assert.notDeepInclude(calls, { name: 'showNeedsNetwork' });
    });
  });

  describe('offline or failure: tell the user and change nothing', () => {
    it('offline: does not call the server, shows the error, stays linked', async () => {
      const { deps, calls } = setup({ isConnected: false });
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual(result, 'failed');
      assert.deepStrictEqual(calls, [{ name: 'showNeedsNetwork' }]);
    });

    it('network error (HTTPError code 0): shows the error, stays linked', async () => {
      const { deps, calls } = setup({
        removeOurDevice: () => Promise.reject(makeHttpError(0)),
      });
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual(result, 'failed');
      assert.deepStrictEqual(calls, [
        { name: 'removeOurDevice', deviceId: 3 },
        { name: 'removeOurDevice:settled' },
        { name: 'showNeedsNetwork' },
      ]);
    });

    for (const code of [429, 500, 503]) {
      it(`server error (${code}): shows the error, stays linked`, async () => {
        const { deps, calls } = setup({
          removeOurDevice: () => Promise.reject(makeHttpError(code)),
        });
        const result = await tellomiLogoutKeepHistory(deps);

        assert.strictEqual(result, 'failed');
        assert.notDeepInclude(calls, { name: 'unlinkAndDisconnect' });
        assert.deepInclude(calls, { name: 'showNeedsNetwork' });
      });
    }

    it('timeout / any other error: shows the error, stays linked', async () => {
      const { deps, calls } = setup({
        removeOurDevice: () => Promise.reject(new Error('timed out')),
      });
      const result = await tellomiLogoutKeepHistory(deps);

      assert.strictEqual(result, 'failed');
      assert.notDeepInclude(calls, { name: 'unlinkAndDisconnect' });
      assert.strictEqual(
        calls.filter(call => call.name === 'showNeedsNetwork').length,
        1
      );
    });
  });
});
