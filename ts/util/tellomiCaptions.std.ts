// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

type CaptionedMessage = Readonly<{
  tellomiMessageCaption?: string;
  attachments?: ReadonlyArray<Readonly<{ caption?: string }>>;
}>;

/**
 * Tellomi (ADR-0075 §4.4; owner 2026-10-14: as Telegram): what the bubble shows for a message
 * that has per-media captions or a caption for the whole message.
 *
 * - One caption in all (the whole message's, or one photo's): that one.
 * - Two or more: only the caption for the whole message, or none; the per-media ones are read
 *   in the lightbox, one per item (Telegram: `GroupedMessages.calculate` drops the album caption
 *   once a second item has one).
 *
 * `undefined` means there is nothing of the kind: the bubble shows the body, as upstream. For the
 * others `body` is the text for clients that don't know these captions (all of them, one per line).
 */
export function getTellomiBubbleCaption(
  message: CaptionedMessage
): { text: string | undefined } | undefined {
  const messageCaption = message.tellomiMessageCaption || undefined;
  const mediaCaptions = (message.attachments ?? [])
    .map(attachment => attachment.caption)
    .filter((caption): caption is string => Boolean(caption));
  if (messageCaption == null && mediaCaptions.length === 0) {
    return undefined;
  }
  const all = messageCaption
    ? [messageCaption, ...mediaCaptions]
    : mediaCaptions;
  if (all.length === 1) {
    return { text: all[0] };
  }
  return { text: messageCaption };
}
