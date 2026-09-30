// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import type { LinkPreviewType } from '../types/message/LinkPreviews.std.ts';
import { getValidLinkPreviews } from '../util/getValidLinkPreviews.node.ts';
import type {
  LinkMessageContext,
  LinkPreviewForClassify,
  ReceivedLinkPreviewDecisionType,
} from './linkCard.std.ts';
import {
  parseReceiveCheck,
  toMessageContextJson,
  toPreviewInputJson,
} from './linkCard.std.ts';
import { getLinkErrorKind } from './linkLog.std.ts';
import {
  classifyLinkPreview,
  getLinkRegistry,
} from './linkRegistry.preload.ts';

const log = createLogger('receivedLinkPreviews');

// What to do with a preview that just arrived, before the message is stored (ADR-0063 §5.1 rule 4,
// §6.1, §7.4). Two questions, both asked of rust/links so every client answers them the same way:
// - `receive_check`: keep the preview at all (its URL is a legal preview URL and is in the body; a
//   story's need not be), and keep its `rich` (within the size limits, §6.1);
// - `classify`: the level the card lands on with this registry, right now. Whether that card shows
//   the picture (`show_image`) decides whether the picture is kept: a brand shell, a user or an
//   official card and a plain link never show it (§7.4), so it is not kept and never downloaded.
//   The level is fixed at this moment, hot updates do not chase it.
// `undefined` = no decision, and the preview goes through exactly as it did before this check
// existed: without a registry, when rust/links throws, or answers something unreadable. Receiving
// a message never fails because of this, and never loses one.
function decideReceivedLinkPreview(
  preview: LinkPreviewType,
  body: string,
  context: LinkMessageContext
): ReceivedLinkPreviewDecisionType | undefined {
  const registry = getLinkRegistry();
  if (!registry) {
    return undefined;
  }

  const input: LinkPreviewForClassify = {
    url: preview.url,
    title: preview.title,
    description: preview.description,
    hasImage: preview.image != null,
    date: preview.date,
    rich: preview.rich,
  };

  let check;
  try {
    check = parseReceiveCheck(
      registry.receiveCheck(
        toPreviewInputJson(input),
        body,
        toMessageContextJson(context)
      )
    );
  } catch (error) {
    // Never the URL: an error's message can quote it (ADR-0063 §6.5).
    log.warn(`receive check failed: ${getLinkErrorKind(error)}`);
    return undefined;
  }
  if (!check) {
    log.warn('receive check gave an answer that cannot be read');
    return undefined;
  }

  if (!check.keep_preview) {
    return { keepPreview: false, keepRich: false, keepImage: false };
  }
  if (!check.keep_rich && preview.rich != null) {
    log.warn('dropped the rich content of a received link preview');
  }

  // No picture, nothing to decide. A card that cannot be decided keeps the picture, as before.
  let keepImage = true;
  if (preview.image != null) {
    const card = classifyLinkPreview(
      { ...input, rich: check.keep_rich ? input.rich : undefined },
      body,
      context
    );
    if (card) {
      keepImage = card.show_image;
      if (!keepImage) {
        log.info(
          `not keeping the picture of a received link preview (${card.level})`
        );
      }
    }
  }

  return {
    keepPreview: true,
    keepRich: check.keep_rich,
    keepImage,
  };
}

// The previews of a message that just arrived, or of an edit of one: Signal's own filter
// (`getValidLinkPreviews`) with rust/links' decision in it. The body and the content types of the
// message's attachments are what rust/links judges the preview against.
export function getReceivedLinkPreviews(
  previews: ReadonlyArray<LinkPreviewType>,
  body: string | null | undefined,
  {
    isStory,
    attachmentContentTypes,
  }: {
    isStory: boolean;
    attachmentContentTypes: ReadonlyArray<string>;
  }
): Array<LinkPreviewType> {
  const context: LinkMessageContext = { isStory, attachmentContentTypes };
  return getValidLinkPreviews(previews, body, {
    isStory,
    decide: preview => decideReceivedLinkPreview(preview, body ?? '', context),
  });
}
