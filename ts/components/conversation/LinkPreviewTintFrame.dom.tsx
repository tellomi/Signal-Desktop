// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties, HTMLAttributes, JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { LRUCache } from 'lru-cache';

import { createLogger } from '../../logging/log.std.ts';
import type {
  LinkCardLayoutType,
  LinkCardTintType,
} from '../../linkPreviews/linkCardVisual.std.ts';
import { getLinkCardTintColors } from '../../linkPreviews/linkCardVisual.std.ts';
import { ThemeType } from '../../types/Util.std.ts';

const log = createLogger('LinkPreviewTintFrame');

// card-visual §3.3 / §3.8: rust/links wants the card's own image decoded to RGBA; every platform
// hands it the same 32 × 32 reduction, so it samples the same way everywhere.
const TINT_SIZE = 32;

export type GetLinkCardTintType = (
  layout: LinkCardLayoutType,
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBuffer>
) => LinkCardTintType | undefined;

// The result per image and layout: the same picture is decoded once, however often the message
// is drawn.
const tintCache = new LRUCache<string, LinkCardTintType | 'none'>({ max: 200 });

async function readReducedRgba(
  url: string
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image failed to load'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = TINT_SIZE;
  canvas.height = TINT_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return undefined;
  }
  context.drawImage(image, 0, 0, TINT_SIZE, TINT_SIZE);
  const { data } = context.getImageData(0, 0, TINT_SIZE, TINT_SIZE);
  return new Uint8Array(data.buffer.slice(0));
}

// The tint of a card, once its image is on this device: undefined until then, and for good when it
// cannot be read (the card keeps its default colours).
function useLinkCardTint({
  enabled,
  imageUrl,
  layout,
  getLinkCardTint,
}: Readonly<{
  enabled: boolean;
  imageUrl: string | undefined;
  layout: LinkCardLayoutType | undefined;
  getLinkCardTint: GetLinkCardTintType | undefined;
}>): LinkCardTintType | undefined {
  const key = imageUrl && layout ? `${layout}\u0000${imageUrl}` : undefined;
  const [resolved, setResolved] = useState<
    Readonly<{ key: string; tint: LinkCardTintType | undefined }> | undefined
  >();

  const cached = key ? tintCache.get(key) : undefined;

  useEffect(() => {
    if (!enabled || !key || !imageUrl || !layout || !getLinkCardTint) {
      return undefined;
    }
    if (tintCache.get(key) !== undefined) {
      return undefined;
    }

    let canceled = false;
    void (async () => {
      try {
        const rgba = await readReducedRgba(imageUrl);
        if (!rgba || canceled) {
          return;
        }
        const tint = getLinkCardTint(layout, TINT_SIZE, TINT_SIZE, rgba);
        tintCache.set(key, tint ?? 'none');
        if (!canceled) {
          setResolved({ key, tint });
        }
      } catch {
        // Only that it failed, never the address of the image.
        log.warn('could not read the image to tint the card');
        tintCache.set(key, 'none');
      }
    })();
    return () => {
      canceled = true;
    };
  }, [enabled, getLinkCardTint, imageUrl, key, layout]);

  if (!enabled) {
    return undefined;
  }
  if (cached !== undefined) {
    return cached === 'none' ? undefined : cached;
  }
  return resolved && resolved.key === key ? resolved.tint : undefined;
}

// The card's frame: the tint, when there is one, is two CSS variables that the card's styles use.
export function LinkPreviewTintFrame({
  children,
  className,
  enabled,
  getLinkCardTint,
  imageUrl,
  layout,
  theme,
  ...divProps
}: Readonly<
  {
    children: ReactNode;
    enabled: boolean;
    getLinkCardTint: GetLinkCardTintType | undefined;
    imageUrl: string | undefined;
    layout: LinkCardLayoutType | undefined;
    theme: ThemeType | undefined;
  } & HTMLAttributes<HTMLDivElement>
>): JSX.Element {
  const tint = useLinkCardTint({ enabled, imageUrl, layout, getLinkCardTint });
  const colors = getLinkCardTintColors(
    tint,
    theme === ThemeType.dark ? 'dark' : 'light'
  );
  const style = colors
    ? ({
        '--link-card-background': colors.background,
        '--link-card-text': colors.text,
      } as CSSProperties)
    : undefined;

  return (
    <div
      {...divProps}
      className={classNames(className, {
        'module-message__link-preview--tinted': colors != null,
      })}
      style={style}
    >
      {children}
    </div>
  );
}
