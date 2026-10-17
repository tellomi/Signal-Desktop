// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import * as Errors from '../types/errors.std.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { getTellomiRestriction } from '../textsecure/WebAPI.preload.ts';
import { HOUR } from '../util/durations/index.std.ts';
import { drop } from '../util/drop.std.ts';
import {
  isTellomiRestrictionActive,
  parseTellomiRestriction,
} from '../util/tellomiRestriction.std.ts';
import type { TellomiRestriction } from '../util/tellomiRestriction.std.ts';

const log = createLogger('tellomiRestriction');

// Tellomi（tellomi/tellomi ADR-0078 §3.4 第三刀）：告诉被人工处置的人为什么发不出去、到什么时候、去哪申诉。
//
// 服务端的说明有两条来路：发消息被拒的 403 自带（handleMessageSend 交给 noteTellomiRestriction），
// 以及 GET /v1/tellomi/restriction（连上之后、回到前台时问，至多每 6 小时一次；发送被拒但 body 读不到时也问）。
// 结果存在 itemStorage 的 tellomiRestriction，左栏横幅显示它；截止时间一到自动清掉，问到「没有」也清掉。
// 电脑端不会遇到 suspended 的说明：暂停的账号连不上服务器，电脑端看到的是「已解除关联」。

const REFRESH_INTERVAL = 6 * HOUR;

let lastRefreshAt = 0;
let refreshing: Promise<void> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleExpiry(restriction: TellomiRestriction | undefined): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }
  if (!restriction) {
    return;
  }
  // setTimeout 超过 2^31-1 毫秒会立即触发；更远的截止时间分段等
  const delay = Math.min(restriction.until - Date.now(), 2 ** 31 - 1);
  expiryTimer = setTimeout(
    () => {
      expiryTimer = undefined;
      const current = itemStorage.get('tellomiRestriction');
      if (isTellomiRestrictionActive(current, Date.now())) {
        scheduleExpiry(current);
      } else {
        drop(store(undefined));
      }
    },
    Math.max(delay, 0)
  );
}

async function store(
  restriction: TellomiRestriction | undefined
): Promise<void> {
  if (isTellomiRestrictionActive(restriction, Date.now())) {
    log.info(`active: ${restriction.level}`);
    await itemStorage.put('tellomiRestriction', restriction);
    scheduleExpiry(restriction);
  } else {
    if (itemStorage.get('tellomiRestriction')) {
      log.info('cleared');
    }
    await itemStorage.remove('tellomiRestriction');
    scheduleExpiry(undefined);
  }
}

// 发送失败里带着的说明（不再去问服务端）。
export function noteTellomiRestriction(restriction: TellomiRestriction): void {
  lastRefreshAt = Date.now();
  drop(store(restriction));
}

// 问服务端一次；同时只跑一个。失败（断网、老服务端 404）不动现有的横幅。
export function refreshTellomiRestriction(reason: string): Promise<void> {
  if (refreshing) {
    return refreshing;
  }
  lastRefreshAt = Date.now();
  refreshing = (async () => {
    try {
      const body = await getTellomiRestriction();
      await store(parseTellomiRestriction(body));
    } catch (error) {
      log.warn(`refresh (${reason}) failed`, Errors.toLogFormat(error));
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

function refreshIfStale(reason: string): void {
  if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL) {
    drop(refreshTellomiRestriction(reason));
  }
}

// 每次已登录的连接连上时调（background 的 afterEveryAuthConnect）。
export function onTellomiAuthConnect(): void {
  refreshIfStale('connect');
}

export function initializeTellomiRestriction(): void {
  const current = itemStorage.get('tellomiRestriction');
  if (current && !isTellomiRestrictionActive(current, Date.now())) {
    drop(store(undefined));
  } else {
    scheduleExpiry(current);
  }
  window.addEventListener('focus', () => refreshIfStale('focus'));
}
