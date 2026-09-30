// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkPreviewType } from '../types/message/LinkPreviews.std.ts';

// ADR-0063 §7.4: a forwarded message carries the link preview the message has, `rich` as received.
// The forward draft is made from the message's stored attributes, never from the props its bubble
// was drawn with: those are what the receiver's card was decided to be (`card`, `layout`,
// `cardIcon` with the bundled brand icon as a `data:` URL, `firstPartyLocal`, the picture's local
// `url`), and in a message request, or for a message that is just a link, they are only what can
// be drawn from its URL, which has lost the title and `rich` on the way.

type StoredField = Exclude<keyof LinkPreviewType, 'image'>;

// Every field a stored preview has except `image`. A field added to `LinkPreviewType` has to be
// put here, or this does not compile: what is not named does not go into a forwarded message.
const COPIED_AS_STORED: Readonly<Record<StoredField, true>> = {
  title: true,
  description: true,
  domain: true,
  url: true,
  isStickerPack: true,
  isCallLink: true,
  callLinkRoomId: true,
  date: true,
  rich: true,
};

const STORED_FIELDS = Object.keys(COPIED_AS_STORED) as Array<StoredField>;

// The picture can only go on if this device has it (it is read from disk when the message is
// sent): a picture that was never downloaded, or that no card showed and so was never fetched, is
// left out, and the rest of the preview goes on.
function isOnThisDevice(image: NonNullable<LinkPreviewType['image']>): boolean {
  return typeof image.path === 'string' || image.data != null;
}

export function getForwardablePreviews(
  previews: ReadonlyArray<LinkPreviewType> | undefined
): Array<LinkPreviewType> {
  return (previews ?? []).map(preview => {
    const forwarded: LinkPreviewType = { url: preview.url };
    for (const field of STORED_FIELDS) {
      if (preview[field] !== undefined) {
        Object.assign(forwarded, { [field]: preview[field] });
      }
    }
    if (preview.image && isOnThisDevice(preview.image)) {
      forwarded.image = preview.image;
    }
    return forwarded;
  });
}
