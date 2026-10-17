// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { LocalizerType } from '../types/Util.std.ts';
import { SECOND } from '../util/durations/index.std.ts';

export type PropsType = Readonly<{
  i18n: LocalizerType;
  durationMs: number;
  onFinished: () => void;
}>;

const SIZE = 24;
const STROKE_WIDTH = 2.5;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Tellomi (ADR-0079 §4.3): the ring in a timed view-once's viewer. It starts full and empties
 * clockwise from twelve o'clock, without a number (the look of Telegram's secret media viewer
 * on both clients; drawn here our own way), then calls `onFinished`.
 */
export function TellomiViewOnceCountdown({
  i18n,
  durationMs,
  onFinished,
}: PropsType): JSX.Element {
  const ringRef = useRef<SVGCircleElement | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    const start = performance.now();
    let frame: number | undefined;

    const draw = (now: number) => {
      const remaining = Math.max(0, 1 - (now - start) / durationMs);
      // The part left ends at twelve; its start chases clockwise.
      ringRef.current?.setAttribute(
        'stroke-dashoffset',
        String(-CIRCUMFERENCE * (1 - remaining))
      );
      if (remaining > 0) {
        frame = requestAnimationFrame(draw);
      }
    };
    frame = requestAnimationFrame(draw);

    // A timer, not the animation, closes the viewer: frames stop in a hidden window.
    const timeout = setTimeout(() => onFinishedRef.current(), durationMs);

    return () => {
      if (frame != null) {
        cancelAnimationFrame(frame);
      }
      clearTimeout(timeout);
    };
  }, [durationMs]);

  return (
    <svg
      aria-label={i18n('icu:Lightbox--tellomi-view-once-closes-after', {
        seconds: Math.round(durationMs / SECOND),
      })}
      className="Lightbox__tellomi-countdown"
      height={SIZE}
      role="timer"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
    >
      <circle
        className="Lightbox__tellomi-countdown__track"
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        strokeWidth={STROKE_WIDTH}
      />
      <circle
        className="Lightbox__tellomi-countdown__ring"
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        ref={ringRef}
        strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        strokeWidth={STROKE_WIDTH}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}
