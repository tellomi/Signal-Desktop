// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { SECOND } from './durations/index.std.ts';

// ADR-0079: a view-once photo / video can say how long it stays open once viewed. Only these
// values count, and only on a view-once message; anything else is an ordinary view-once.
const TELLOMI_VIEW_ONCE_SECONDS: ReadonlySet<number> = new Set([3, 10, 30]);

export function getTellomiViewOnceSeconds({
  isViewOnce,
  seconds,
}: {
  isViewOnce: boolean | null | undefined;
  seconds: number | null | undefined;
}): number | undefined {
  if (!isViewOnce || seconds == null) {
    return undefined;
  }
  return TELLOMI_VIEW_ONCE_SECONDS.has(seconds) ? seconds : undefined;
}

// A photo stays open for the seconds; a video for the seconds or the whole video, whichever is
// longer (ADR-0079 §4.3). A video whose duration isn't known yet gets the seconds.
export function getTellomiViewOnceViewerDurationMs(
  seconds: number,
  videoDurationSeconds?: number
): number {
  const video =
    videoDurationSeconds != null && Number.isFinite(videoDurationSeconds)
      ? videoDurationSeconds
      : 0;
  return Math.max(seconds, video) * SECOND;
}
