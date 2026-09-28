// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  AttachmentType,
  AttachmentForUIType,
  AttachmentWithHydratedData,
} from '../Attachment.std.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';

type GenericLinkPreviewType<Image> = {
  title?: string;
  description?: string;
  domain?: string;
  url: string;
  isStickerPack?: boolean;
  isCallLink?: boolean;
  callLinkRoomId?: string;
  image?: Readonly<Image>;
  date?: number;
  // Tellomi (ADR-0063 §7.4): `Preview.rich` (field 1000), base64 of the bytes as received; set on
  // an outgoing preview, it is sent unchanged.
  rich?: string;
};

export type LinkPreviewType = GenericLinkPreviewType<AttachmentType>;
export type LinkPreviewForUIType =
  GenericLinkPreviewType<AttachmentForUIType> & {
    // Tellomi (ADR-0063 §5.1 rule 4): the receiver's decision for this preview, computed in the
    // data layer at display time; never stored.
    card?: LinkCardType;
  };
export type LinkPreviewWithHydratedData =
  GenericLinkPreviewType<AttachmentWithHydratedData>;

export function isSameLinkPreview(
  prev: LinkPreviewType | undefined | null,
  next: LinkPreviewType | undefined | null
): boolean {
  // Both has to be absent or present
  if (prev == null || next == null) {
    return prev == null && next == null;
  }

  if (prev.url !== next.url) {
    return false;
  }
  if (prev.title !== next.title) {
    return false;
  }
  if (prev.description !== next.description) {
    return false;
  }
  if (prev.image?.plaintextHash !== next.image?.plaintextHash) {
    return false;
  }

  return true;
}
