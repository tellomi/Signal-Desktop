// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReceivedLinkPreviewDecisionType } from '../linkPreviews/linkCard.std.ts';
import type { LinkPreviewType } from '../types/message/LinkPreviews.std.ts';
import * as LinkPreview from '../types/LinkPreview.std.ts';
import { getRoomIdFromCallLink } from './callLinksRingrtc.node.ts';
import { isNotNil } from './isNotNil.std.ts';

// What of a preview is kept once rust/links has decided (ADR-0063 §7.4): `rich` as received, or
// gone; the picture, or gone (a preview without one is never downloaded).
function applyDecision(
  item: LinkPreviewType,
  { keepRich, keepImage }: ReceivedLinkPreviewDecisionType
): LinkPreviewType {
  if (keepRich && keepImage) {
    return item;
  }
  const kept = { ...item };
  if (!keepRich) {
    delete kept.rich;
  }
  if (!keepImage) {
    delete kept.image;
  }
  return kept;
}

export function getValidLinkPreviews(
  previews: ReadonlyArray<LinkPreviewType>,
  body: string | null | undefined,
  {
    isStory,
    decide,
  }: {
    isStory: boolean;
    // Tellomi (ADR-0063 §5.1 rule 4, §7.4): rust/links' decision about one preview before it is
    // stored. When it gives one it replaces the "URL is in the body" check (the one rule all
    // clients share) and can drop the preview's `rich` or its picture; Signal's other checks (an
    // https URL that is not on the excluded list) stay. No decision (no registry, or it failed) =
    // Signal's own check, exactly as before.
    decide?: (
      preview: LinkPreviewType
    ) => ReceivedLinkPreviewDecisionType | undefined;
  }
): Array<LinkPreviewType> {
  const urlsInBody = LinkPreview.findLinks(body || '');

  const validated = previews
    .map((item: LinkPreviewType) => {
      const decision = decide?.(item);
      if (decision) {
        if (
          !item.url ||
          !LinkPreview.shouldPreviewHref(item.url) ||
          !decision.keepPreview
        ) {
          return null;
        }
      } else if (
        !LinkPreview.isValidLinkPreview(urlsInBody, item, { isStory })
      ) {
        return null;
      }

      const kept = decision ? applyDecision(item, decision) : item;

      if (LinkPreview.isCallLink(item.url)) {
        return {
          ...kept,
          isCallLink: true,
          callLinkRoomId: getRoomIdFromCallLink(item.url),
        };
      }

      return kept;
    })
    .filter(isNotNil);

  return validated;
}
