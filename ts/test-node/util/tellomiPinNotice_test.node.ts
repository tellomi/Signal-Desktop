// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { AttachmentType } from '../../types/Attachment.std.ts';
import { BodyRange } from '../../types/BodyRange.std.ts';
import type { HydratedBodyRangeType } from '../../types/BodyRange.std.ts';
import * as MIME from '../../types/MIME.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import {
  clipTellomiPinText,
  doesTellomiPinNoticeNotify,
  getTellomiPinNoticeText,
  getTellomiPinSubject,
} from '../../util/tellomiPinNotice.std.ts';
import type { TellomiPinTarget } from '../../util/tellomiPinNotice.std.ts';
import i18n from './i18n.node.ts';

// ADR-0081 §4.4, pinned-messages.md 3.2: the same cases as Android's and iOS's `TellomiPinNoticeTest`.
describe('tellomiPinNotice', () => {
  function attachment(
    contentType: MIME.MIMEType,
    extra: Partial<AttachmentType> = {}
  ): AttachmentType {
    return { contentType, size: 100, ...extra };
  }

  function subjectOf(
    target: TellomiPinTarget | undefined,
    bodyRanges: ReadonlyArray<HydratedBodyRangeType> = []
  ) {
    return getTellomiPinSubject(target, bodyRanges);
  }

  describe('clipTellomiPinText', () => {
    it('keeps up to 15 characters and clips longer text with an ellipsis', () => {
      assert.strictEqual(clipTellomiPinText('Lunch at noon'), 'Lunch at noon');
      assert.strictEqual(
        clipTellomiPinText('一二三四五六七八九十一二三四五'),
        '一二三四五六七八九十一二三四五'
      );
      assert.strictEqual(
        clipTellomiPinText('一二三四五六七八九十一二三四五六'),
        '一二三四五六七八九十一二三四五…'
      );
    });

    it('counts an emoji as one character and never splits it', () => {
      const family = '👨‍👩‍👧‍👦';
      assert.strictEqual(
        clipTellomiPinText(family.repeat(16)),
        `${family.repeat(15)}…`
      );
    });

    it('makes one line', () => {
      assert.strictEqual(clipTellomiPinText(' a \n\n b \n'), 'a b');
    });
  });

  describe('getTellomiPinSubject', () => {
    it('is nothing when the message is gone or deleted for everyone', () => {
      assert.isUndefined(subjectOf(undefined));
      assert.isUndefined(subjectOf({ body: 'hi', deletedForEveryone: true }));
      assert.isUndefined(subjectOf({ body: 'hi', isErased: true }));
      assert.isUndefined(subjectOf({ body: '  ' }));
    });

    it('quotes the text, with names for mentions and spoilers hidden', () => {
      assert.deepEqual(subjectOf({ body: 'See you at 8' }), {
        kind: 'text',
        text: 'See you at 8',
      });

      const mention: HydratedBodyRangeType = {
        start: 4,
        length: 1,
        mentionAci: generateAci(),
        conversationID: 'c1',
        replacementText: 'Alice',
      };
      assert.deepEqual(subjectOf({ body: 'Ask ￼' }, [mention]), {
        kind: 'text',
        text: 'Ask @Alice',
      });

      const spoiler: HydratedBodyRangeType = {
        start: 7,
        length: 6,
        style: BodyRange.Style.SPOILER,
      };
      assert.deepEqual(subjectOf({ body: 'Answer secret' }, [spoiler]), {
        kind: 'text',
        text: 'Answer ■■■■',
      });
    });

    it('tells media by what it is, even with a caption', () => {
      const kind = (target: TellomiPinTarget) => subjectOf(target)?.kind;

      assert.strictEqual(
        kind({ body: 'caption', attachments: [attachment(MIME.IMAGE_JPEG)] }),
        'photo'
      );
      assert.strictEqual(
        kind({ attachments: [attachment(MIME.VIDEO_MP4)] }),
        'video'
      );
      assert.strictEqual(
        kind({ attachments: [attachment(MIME.IMAGE_GIF)] }),
        'gif'
      );
      assert.strictEqual(
        kind({
          attachments: [
            attachment(MIME.AUDIO_AAC, {
              flags: Proto.AttachmentPointer.Flags.VOICE_MESSAGE,
            }),
          ],
        }),
        'voice-message'
      );
      assert.strictEqual(
        kind({
          attachments: [attachment(MIME.AUDIO_MP3, { fileName: 'song.mp3' })],
        }),
        'audio'
      );
      assert.strictEqual(
        kind({
          attachments: [
            attachment(MIME.APPLICATION_OCTET_STREAM, { fileName: 'a.zip' }),
          ],
        }),
        'file'
      );
      assert.strictEqual(
        kind({
          sticker: {} as NonNullable<TellomiPinTarget['sticker']>,
        }),
        'sticker'
      );
      assert.strictEqual(
        kind({
          contact: [{}],
        }),
        'contact'
      );
      assert.strictEqual(
        kind({ poll: {} as NonNullable<TellomiPinTarget['poll']> }),
        'poll'
      );
      assert.strictEqual(
        kind({
          body: '星巴克臻选上海烘焙工坊\n静安区南京西路789号兴业太古汇\nhttps://maps.google.com/maps?q=31.2297%2C121.4560',
          attachments: [attachment(MIME.IMAGE_JPEG)],
        }),
        'location'
      );
    });
  });

  describe('getTellomiPinNoticeText', () => {
    it('says who pinned what, and "a message" when it is gone', () => {
      assert.strictEqual(
        getTellomiPinNoticeText(i18n, {
          isMe: false,
          senderTitle: 'Alice',
          subject: { kind: 'text', text: 'See you at 8' },
        }),
        'Alice pinned “See you at 8”'
      );
      assert.strictEqual(
        getTellomiPinNoticeText(i18n, {
          isMe: true,
          senderTitle: '',
          subject: { kind: 'photo' },
        }),
        'You pinned a photo'
      );
      assert.strictEqual(
        getTellomiPinNoticeText(i18n, {
          isMe: false,
          senderTitle: 'Alice',
          subject: undefined,
        }),
        'Alice pinned a message'
      );
    });
  });

  describe('doesTellomiPinNoticeNotify', () => {
    it('notifies only for someone else’s pin in a group, unless it is silent', () => {
      assert.isTrue(
        doesTellomiPinNoticeNotify({
          isGroup: true,
          isMe: false,
          isSilent: false,
        })
      );
      assert.isFalse(
        doesTellomiPinNoticeNotify({
          isGroup: false,
          isMe: false,
          isSilent: false,
        }),
        'a 1:1 pin does not notify'
      );
      assert.isFalse(
        doesTellomiPinNoticeNotify({
          isGroup: true,
          isMe: false,
          isSilent: true,
        }),
        'Pin without notifying'
      );
      assert.isFalse(
        doesTellomiPinNoticeNotify({
          isGroup: true,
          isMe: true,
          isSilent: false,
        }),
        'my own pin'
      );
    });
  });
});
