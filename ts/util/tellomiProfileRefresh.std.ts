// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { DAY, HOUR } from './durations/index.std.ts';
import { isNormalNumber } from './isNormalNumber.std.ts';

// Tellomi（tellomi/tellomi#1366）：对方改了头像 / 名字，这边要及时一点看到。服务端改资料时不通知任何人（上游设计），
// 这边只能自己重拉；上游 Desktop 只在打开会话（5 分钟节流）和例行刷新（每小时一轮、只挑 3 天没拉过的人、每轮最多 50 个）时拉。
// 这里补两条，都不动协议，规则和安卓 / iOS 一样：
// - 收到 1:1 对方的消息，距上次拉这个人超过 1 小时就顺手拉一次（handleDataMessage）；
// - 例行刷新：最近 30 天有来往的会话 6 小时没拉过就算旧（其余照上游 3 天）。

/** 收到 1:1 消息时，距上次拉这个人多久就顺手重拉。 */
const REFRESH_ON_MESSAGE_AFTER = HOUR;
/** 例行刷新：最近有来往的会话多久没拉过算旧。 */
const ACTIVE_STALE_AFTER = 6 * HOUR;
/** 例行刷新：多久之内有来往算「最近」。 */
const ACTIVE_WITHIN = 30 * DAY;

/** 收到 1:1 对方的消息：从没拉过、或上次拉在 1 小时以前（时钟往回拨过也算）就重拉。 */
export function shouldRefreshProfileOnMessage(
  profileLastFetchedAt: unknown,
  now: number
): boolean {
  if (!isNormalNumber(profileLastFetchedAt)) {
    return true;
  }
  return (
    now < profileLastFetchedAt ||
    now - profileLastFetchedAt >= REFRESH_ON_MESSAGE_AFTER
  );
}

/**
 * 例行刷新里这个会话的资料多久之内算新：最近 30 天有来往（`active_at`）的是 6 小时，其余照上游（`upstreamMaxAge`，3 天）。
 */
export function routineRefreshMaxAge(
  activeAt: unknown,
  now: number,
  upstreamMaxAge: number
): number {
  if (isNormalNumber(activeAt) && now - activeAt <= ACTIVE_WITHIN) {
    return Math.min(ACTIVE_STALE_AFTER, upstreamMaxAge);
  }
  return upstreamMaxAge;
}
