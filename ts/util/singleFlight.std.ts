// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// 同一时间只跑一遍：上一遍还没结束时再调用，拿到的是同一个 Promise（成功或失败都一样）；
// 结束以后再调用就重新跑。task 同步开始（调用当下就开始跑）。
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  let isRunning = false;

  async function run(): Promise<T> {
    isRunning = true;
    try {
      return await task();
    } finally {
      isRunning = false;
      inFlight = undefined;
    }
  }

  return () => {
    if (inFlight) {
      return inFlight;
    }
    const current = run();
    // task 同步抛错时 run() 在返回前就结束了（finally 已经跑过），不能把这个结束了的 Promise 记下来
    if (isRunning) {
      inFlight = current;
    }
    return current;
  };
}
