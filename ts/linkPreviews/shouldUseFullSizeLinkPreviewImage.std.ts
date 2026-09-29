// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkPreviewType } from '../types/message/LinkPreviews.std.ts';
import { isImageAttachment } from '../util/Attachment.std.ts';
import type { LinkCardLayoutType } from './linkCardVisual.std.ts';

const MINIMUM_FULL_SIZE_DIMENSION = 200;

export function shouldUseFullSizeLinkPreviewImage({
  isStickerPack,
  image,
  layout,
}: Readonly<LinkPreviewType> &
  Readonly<{ layout?: LinkCardLayoutType }>): boolean {
  if (isStickerPack || !image || !isImageAttachment(image)) {
    return false;
  }

  // Tellomi (card-visual §3.2): when rust/links decided the card's shape, that decision stands,
  // with no threshold of our own.
  if (layout) {
    return layout === 'large_image';
  }

  const { width, height } = image;

  return (
    isDimensionFullSize(width) &&
    isDimensionFullSize(height) &&
    !isRoughlySquare(width, height)
  );
}

function isDimensionFullSize(dimension: unknown): dimension is number {
  return (
    typeof dimension === 'number' && dimension >= MINIMUM_FULL_SIZE_DIMENSION
  );
}

function isRoughlySquare(width: number, height: number): boolean {
  return Math.abs(1 - width / height) < 0.05;
}
