// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyMessageAttributesType } from '../model-types.d.ts';
import type { HydratedBodyRangeType } from '../types/BodyRange.std.ts';
import { applyRangesToText } from '../types/BodyRange.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import * as MIME from '../types/MIME.std.ts';
import * as Attachment from './Attachment.std.ts';
import { getSegmenter } from './grapheme.std.ts';
import { missingCaseError } from './missingCaseError.std.ts';
import { isTellomiLocationMessage } from './tellomiLocationMessage.std.ts';

// ADR-0081 §4.4, pinned-messages.md 3.2: the line a pin makes — "×× pinned “first 15 characters…”", "You pinned a
// photo", and "×× pinned a message" when the pinned message is gone. The chat event, the left pane and the notification
// all say the same line, as on the phones (Android and iOS `TellomiPinNotice`).
//
// From Telegram (the mechanism only, no code): iOS `TelegramStringFormatting/Sources/ServiceMessageStrings.swift` (one
// line, more than 15 characters clipped to 15 plus an ellipsis, a phrase per kind of media) and Android
// `MessageObject.java` (`ActionPinnedText` clips to 20, `ActionPinnedPhoto` and so on). A photo or video with a caption
// is told by its media on both.

// How many characters go in the quote (graphemes, so an emoji is never split).
export const TELLOMI_PIN_PREVIEW_LENGTH = 15;

// What the pinned message is, kept on the chat event (`tellomiPinSubject`) when it is made, and redone when the pinned
// message is edited or deleted. None = "a message".
export type TellomiPinSubject =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{
      kind:
        | 'photo'
        | 'video'
        | 'gif'
        | 'voice-message'
        | 'audio'
        | 'file'
        | 'sticker'
        | 'location'
        | 'contact'
        | 'poll';
    }>;

export type TellomiPinTarget = Pick<
  ReadonlyMessageAttributesType,
  | 'attachments'
  | 'body'
  | 'contact'
  | 'deletedForEveryone'
  | 'isErased'
  | 'poll'
  | 'sticker'
>;

// One line (line breaks become spaces), clipped to TELLOMI_PIN_PREVIEW_LENGTH characters plus "…" when longer.
export function clipTellomiPinText(text: string): string {
  const oneLine = text.replace(/\s*\n\s*/g, ' ').trim();
  let clipped = '';
  let count = 0;
  for (const { segment } of getSegmenter().segment(oneLine)) {
    if (count === TELLOMI_PIN_PREVIEW_LENGTH) {
      return `${clipped}…`;
    }
    clipped += segment;
    count += 1;
  }
  return oneLine;
}

// The subject for a pinned message; undefined when it is gone, deleted for everyone or has nothing to say.
// `bodyRanges` are the target's ranges, hydrated by the caller (mentions become names, spoilers are hidden as in
// notifications).
export function getTellomiPinSubject(
  target: TellomiPinTarget | undefined,
  bodyRanges: ReadonlyArray<HydratedBodyRangeType>
): TellomiPinSubject | undefined {
  if (target == null || target.deletedForEveryone || target.isErased) {
    return undefined;
  }

  const attachments = target.attachments ?? [];
  if (target.contact?.length) {
    return { kind: 'contact' };
  }
  if (isTellomiLocationMessage(target.body, attachments)) {
    return { kind: 'location' };
  }
  if (target.poll != null) {
    return { kind: 'poll' };
  }
  if (target.sticker != null) {
    return { kind: 'sticker' };
  }
  const attachment = attachments[0];
  if (attachment != null) {
    if (
      attachment.contentType === MIME.IMAGE_GIF ||
      Attachment.isGIF(attachments)
    ) {
      return { kind: 'gif' };
    }
    if (Attachment.isVideo(attachments)) {
      return { kind: 'video' };
    }
    if (Attachment.isImage(attachments)) {
      return { kind: 'photo' };
    }
    if (Attachment.isVoiceMessage(attachment)) {
      return { kind: 'voice-message' };
    }
    if (Attachment.isAudio(attachments)) {
      return { kind: 'audio' };
    }
    return { kind: 'file' };
  }

  const { body } = applyRangesToText(
    { body: target.body ?? '', bodyRanges },
    { replaceMentions: true, replaceSpoilers: true }
  );
  const text = clipTellomiPinText(body ?? '');
  return text === '' ? undefined : { kind: 'text', text };
}

// "“…”", "a photo" and so on; "a message" without a subject.
export function getTellomiPinSubjectText(
  i18n: LocalizerType,
  subject: TellomiPinSubject | undefined
): string {
  if (subject == null) {
    return i18n('icu:TellomiPinNotice__AMessage');
  }
  switch (subject.kind) {
    case 'text':
      return i18n('icu:TellomiPinNotice__Quote', { text: subject.text });
    case 'photo':
      return i18n('icu:TellomiPinNotice__APhoto');
    case 'video':
      return i18n('icu:TellomiPinNotice__AVideo');
    case 'gif':
      return i18n('icu:TellomiPinNotice__AGif');
    case 'voice-message':
      return i18n('icu:TellomiPinNotice__AVoiceMessage');
    case 'audio':
      return i18n('icu:TellomiPinNotice__AnAudioFile');
    case 'file':
      return i18n('icu:TellomiPinNotice__AFile');
    case 'sticker':
      return i18n('icu:TellomiPinNotice__ASticker');
    case 'location':
      return i18n('icu:TellomiPinNotice__ALocation');
    case 'contact':
      return i18n('icu:TellomiPinNotice__AContact');
    case 'poll':
      return i18n('icu:TellomiPinNotice__APoll');
    default:
      throw missingCaseError(subject);
  }
}

// The whole line, for the left pane and notifications.
export function getTellomiPinNoticeText(
  i18n: LocalizerType,
  {
    isMe,
    senderTitle,
    subject,
  }: Readonly<{
    isMe: boolean;
    senderTitle: string;
    subject: TellomiPinSubject | undefined;
  }>
): string {
  const subjectText = getTellomiPinSubjectText(i18n, subject);
  return isMe
    ? i18n('icu:TellomiPinNotice__YouPinned', { subject: subjectText })
    : i18n('icu:TellomiPinNotice__SomeonePinned', {
        sender: senderTitle,
        subject: subjectText,
      });
}

// Whether someone's pin notifies: only in a group, and not "Pin without notifying" (`pinSilent`). It still counts as
// unread and shows in the left pane. A 1:1 pin doesn't notify: Telegram iOS notifies, Android doesn't (`ChatActivity`,
// 1:1 `checks = {false, false}`, so `notify = false`); only one has it, so not (owner 10-14). My own pins, and pins for
// me only, never notify.
export function doesTellomiPinNoticeNotify({
  isGroup,
  isMe,
  isSilent,
}: Readonly<{
  isGroup: boolean;
  isMe: boolean;
  isSilent: boolean;
}>): boolean {
  return isGroup && !isMe && !isSilent;
}
