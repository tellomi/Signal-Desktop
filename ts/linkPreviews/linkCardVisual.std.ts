// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkCardType } from './linkCard.std.ts';

// card-visual §3.2 / §3.3 / §3.8 (tellomi/tellomi#1421): what a card looks like is decided by two
// pure functions in rust/links, so the composer and all three receivers agree: `layout` (which of
// the four shapes, from the image's pixel size and the kind) and `tint` (background and text colour
// from the card's own image). The client reads the answer here and applies it; it never computes a
// threshold or a colour itself.

export type LinkCardLayoutType =
  // Tellomi's own neutral card with an action button (§5.2).
  | 'first_party'
  // Image on top, full card width; the title bar underneath.
  | 'large_image'
  // Text on the left, a 54 px square icon at the top right (6 px down, corners 4 px), the whole card tinted.
  | 'icon'
  // Title, domain and a link glyph; grey.
  | 'no_image';

// card-visual §3.2 / §3.8: the picture of a large-image card is 1.91:1 at its widest and square at
// its tallest (width ÷ height). A picture outside that range is cropped around its centre: the
// box is given the clamped shape and the picture covers it. This is geometry, not a decision:
// whether a card is a large-image card at all is `layout()` in rust/links.
export const LARGE_IMAGE_ASPECT_RATIO_LIMITS = {
  min: 1,
  max: 1.91,
} as const;

const LAYOUTS: ReadonlyArray<LinkCardLayoutType> = [
  'first_party',
  'large_image',
  'icon',
  'no_image',
];

export function parseLinkCardLayout(
  value: string
): LinkCardLayoutType | undefined {
  return LAYOUTS.find(layout => layout === value);
}

export type LinkCardColorsType = Readonly<{
  background: string;
  text: string;
}>;

export type LinkCardTintType = Readonly<{
  // false: keep the default neutral card colours (a grey or near-white or near-black image).
  tinted: boolean;
  light?: LinkCardColorsType;
  dark?: LinkCardColorsType;
}>;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function readColors(value: unknown): LinkCardColorsType | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const { background, text } = value as Record<string, unknown>;
  if (
    typeof background !== 'string' ||
    typeof text !== 'string' ||
    !HEX_COLOR.test(background) ||
    !HEX_COLOR.test(text)
  ) {
    return undefined;
  }
  return { background, text };
}

export function parseLinkCardTint(json: string): LinkCardTintType | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const { tinted, light, dark } = value as Record<string, unknown>;
  if (typeof tinted !== 'boolean') {
    return undefined;
  }
  if (!tinted) {
    return { tinted: false };
  }
  const lightColors = readColors(light);
  const darkColors = readColors(dark);
  if (!lightColors || !darkColors) {
    return undefined;
  }
  return { tinted: true, light: lightColors, dark: darkColors };
}

export function getLinkCardTintColors(
  tint: LinkCardTintType | undefined,
  theme: 'light' | 'dark'
): LinkCardColorsType | undefined {
  if (!tint?.tinted) {
    return undefined;
  }
  return theme === 'dark' ? tint.dark : tint.light;
}

// Whether to ask for a tint at all: only third-party cards that show an image (`tintable` is false
// for first-party and payment cards). Never in a message request, which rust/links cannot know
// (card-visual §3.3, owner 2026-09-26).
export function shouldTintLinkCard({
  card,
  layout,
  isMessageRequest,
}: Readonly<{
  card: LinkCardType | undefined;
  layout: LinkCardLayoutType | undefined;
  isMessageRequest: boolean;
}>): boolean {
  if (isMessageRequest || !card?.tintable) {
    return false;
  }
  return layout === 'icon' || layout === 'large_image';
}
