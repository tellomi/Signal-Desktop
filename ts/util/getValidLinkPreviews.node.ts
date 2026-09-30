// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReceivedLinkPreviewDecisionType } from '../linkPreviews/linkCard.std.ts';
import { getLinkErrorKind } from '../linkPreviews/linkLog.std.ts';
import { createLogger } from '../logging/log.std.ts';
import type { LinkPreviewType } from '../types/message/LinkPreviews.std.ts';
import * as LinkPreview from '../types/LinkPreview.std.ts';
import { getRoomIdFromCallLink } from './callLinksRingrtc.node.ts';
import { isNotNil } from './isNotNil.std.ts';

const log = createLogger('getValidLinkPreviews');

// Tellomi (ADR-0063 §5.1 rule 2: a preview that goes wrong never becomes an error): the room a call
// link opens is derived from its key, and a link whose key is not one (`#key=garbage`, no key at
// all) makes that throw. Signal lets it end the whole message, which was then never stored and never
// confirmed. One preview that cannot be read is one preview lost, like any other invalid one.
function getCallLinkRoomId(url: string): string | undefined {
  try {
    return getRoomIdFromCallLink(url);
  } catch (error) {
    // Only the kind of the error, never the link: its key is in the `#` part (§6.5).
    log.warn(
      `dropped a call link preview whose key cannot be read: ${getLinkErrorKind(error)}`
    );
    return undefined;
  }
}

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
        const callLinkRoomId = getCallLinkRoomId(item.url);
        if (callLinkRoomId === undefined) {
          return null;
        }
        return {
          ...kept,
          isCallLink: true,
          callLinkRoomId,
        };
      }

      return kept;
    })
    .filter(isNotNil);

  return validated;
}
