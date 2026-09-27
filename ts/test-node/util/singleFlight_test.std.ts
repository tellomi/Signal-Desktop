// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { explodePromise } from '../../util/explodePromise.std.ts';
import { singleFlight } from '../../util/singleFlight.std.ts';

// Tellomi（tellomi/tellomi#1414）：「退出登录」自己触发一次 unlinkAndDisconnect，服务器删掉设备后断开连接又触发一次；
// 同一时间只能跑一遍，后来的直接等前一遍的结果。跑完以后再触发（比如重新关联后又被取消关联）要能再跑。
describe('singleFlight', () => {
  it('runs the task once for overlapping calls and gives everyone the same result', async () => {
    const { promise, resolve } = explodePromise<string>();
    let runs = 0;
    const run = singleFlight(async () => {
      runs += 1;
      return promise;
    });

    const first = run();
    const second = run();
    const third = run();
    assert.strictEqual(runs, 1);

    resolve('done');
    assert.deepStrictEqual(await Promise.all([first, second, third]), [
      'done',
      'done',
      'done',
    ]);
    assert.strictEqual(runs, 1);
  });

  it('runs again once the previous run has finished', async () => {
    let runs = 0;
    const run = singleFlight(async () => {
      runs += 1;
      return runs;
    });

    assert.strictEqual(await run(), 1);
    assert.strictEqual(await run(), 2);
  });

  it('shares a failure with every overlapping caller, then allows a new run', async () => {
    const { promise, reject } = explodePromise<void>();
    let runs = 0;
    const run = singleFlight(async () => {
      runs += 1;
      if (runs === 1) {
        return promise;
      }
    });

    const first = run();
    const second = run();
    reject(new Error('boom'));
    await assert.isRejected(first, 'boom');
    await assert.isRejected(second, 'boom');

    await run();
    assert.strictEqual(runs, 2);
  });

  it('a task that throws synchronously does not block later runs', async () => {
    let runs = 0;
    const run = singleFlight((): Promise<void> => {
      runs += 1;
      if (runs === 1) {
        throw new Error('sync boom');
      }
      return Promise.resolve();
    });

    await assert.isRejected(run(), 'sync boom');
    await run();
    assert.strictEqual(runs, 2);
  });
});
