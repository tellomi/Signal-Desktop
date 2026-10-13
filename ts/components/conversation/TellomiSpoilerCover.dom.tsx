// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties, JSX } from 'react';
import { useEffect, useRef } from 'react';

/** Spec R-1: "about 0.45 s", same as both phones. */
export const TELLOMI_SPOILER_REVEAL_MS = 450;

export type TellomiSpoilerRevealPoint = Readonly<{ x: number; y: number }>;

type Props = Readonly<{
  style?: CSSProperties;
  /** Set once to uncover from that point (in the cover's own pixels). */
  revealFrom?: TellomiSpoilerRevealPoint;
  onRevealed: () => void;
}>;

type Particle = Readonly<{
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  period: number;
  phase: number;
}>;

const PARTICLE_AREA = 14 * 14;
const MIN_PARTICLES = 24;
const MAX_PARTICLES = 420;

/**
 * Tellomi (tellomi/tellomi#1263, spec R-1): the layer over a covered image / video: what's under it
 * blurred (`backdrop-filter`), dimmed, with slowly drifting, twinkling white dust.
 *
 * The mechanism follows Telegram's phones (read only, nothing copied; Telegram Desktop isn't in the
 * reference sources): Android `ChatMessageCell.startRevealMedia` and iOS `MediaDustNode.tap(at:)` uncover
 * from the tapped point with a growing circle while the dust is pulled towards the finger. Here the
 * circle is a radial `mask-image` on this layer, so the original shows through the hole. With
 * "reduce motion" the dust doesn't move and uncovering is immediate.
 */
export function TellomiSpoilerCover({
  style,
  revealFrom,
  onRevealed,
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revealRef = useRef<{
    from: TellomiSpoilerRevealPoint;
    start: number;
  } | null>(null);
  const onRevealedRef = useRef(onRevealed);
  useEffect(() => {
    onRevealedRef.current = onRevealed;
  }, [onRevealed]);

  useEffect(() => {
    if (!revealFrom || revealRef.current) {
      return;
    }
    if (prefersReducedMotion()) {
      onRevealedRef.current();
      return;
    }
    revealRef.current = { from: revealFrom, start: performance.now() };
  }, [revealFrom]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!root || !canvas || !context) {
      return;
    }

    const reduceMotion = prefersReducedMotion();
    const start = performance.now();
    let particles: Array<Particle> = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let isDone = false;

    const draw = (now: number) => {
      if (isDone) {
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      if (root.clientWidth !== width || root.clientHeight !== height) {
        width = root.clientWidth;
        height = root.clientHeight;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        particles = makeParticles(width, height);
      }

      let pull = 0;
      const reveal = revealRef.current;
      if (reveal) {
        const t = Math.min(1, (now - reveal.start) / TELLOMI_SPOILER_REVEAL_MS);
        pull = fastOutSlowIn(t);
        const radius = farthestCorner(reveal.from, width, height) * pull;
        const mask = `radial-gradient(circle at ${reveal.from.x}px ${reveal.from.y}px, transparent ${radius}px, black ${radius + 1}px)`;
        root.style.maskImage = mask;
        root.style.setProperty('-webkit-mask-image', mask);
        if (t >= 1) {
          isDone = true;
          onRevealedRef.current();
          return;
        }
      }

      const seconds = reduceMotion ? 0 : (now - start) / 1000;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        let x = wrap(particle.x * width + particle.vx * seconds, width);
        let y = wrap(particle.y * height + particle.vy * seconds, height);
        if (reveal) {
          // Pulled towards where it was clicked (spec R-1).
          x += (reveal.from.x - x) * pull * 0.6;
          y += (reveal.from.y - y) * pull * 0.6;
        }
        const twinkle =
          0.5 +
          0.5 *
            Math.sin(
              (2 * Math.PI * seconds) / particle.period + particle.phase
            );
        context.globalAlpha = (0.3 + 0.7 * twinkle) * (1 - pull);
        context.fillStyle = '#fff';
        context.beginPath();
        context.arc(x, y, particle.radius, 0, 2 * Math.PI);
        context.fill();
      }

      // With "reduce motion" the dust is drawn once and stands still.
      if (!reduceMotion) {
        frame = requestAnimationFrame(draw);
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      isDone = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="module-image__tellomi-spoiler"
      style={style}
      aria-hidden
      data-testid="TellomiSpoilerCover"
    >
      <canvas ref={canvasRef} className="module-image__tellomi-spoiler__dust" />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

function makeParticles(width: number, height: number): Array<Particle> {
  const count = Math.min(
    MAX_PARTICLES,
    Math.max(MIN_PARTICLES, Math.round((width * height) / PARTICLE_AREA))
  );
  // Same dust for the same size: no jumps when the timeline re-renders.
  let seed = width * 31 + height;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: count }, () => {
    const speed = 4 + random() * 10;
    const angle = random() * 2 * Math.PI;
    return {
      x: random(),
      y: random(),
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
      radius: 0.5 + random() * 0.7,
      period: 1.2 + random() * 1.4,
      phase: random() * 2 * Math.PI,
    };
  });
}

function farthestCorner(
  point: TellomiSpoilerRevealPoint,
  width: number,
  height: number
): number {
  return Math.max(
    Math.hypot(point.x, point.y),
    Math.hypot(width - point.x, point.y),
    Math.hypot(point.x, height - point.y),
    Math.hypot(width - point.x, height - point.y)
  );
}

function wrap(value: number, size: number): number {
  if (size <= 0) {
    return 0;
  }
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

/** Material's "fast out, slow in" (cubic-bezier(0.4, 0, 0.2, 1)), close enough for 0.45 s. */
function fastOutSlowIn(t: number): number {
  // Solve the bezier for x = t with a few Newton steps.
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const x = bezier(u, 0.4, 0.2) - t;
    const dx = bezierDerivative(u, 0.4, 0.2);
    if (Math.abs(dx) < 1e-6) {
      break;
    }
    u -= x / dx;
  }
  return bezier(Math.min(1, Math.max(0, u)), 0, 1);
}

function bezier(u: number, p1: number, p2: number): number {
  const v = 1 - u;
  return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
}

function bezierDerivative(u: number, p1: number, p2: number): number {
  const v = 1 - u;
  return 3 * v * v * p1 + 6 * v * u * (p2 - p1) + 3 * u * u * (1 - p2);
}
