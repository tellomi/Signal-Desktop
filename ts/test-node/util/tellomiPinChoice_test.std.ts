// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  TellomiPinChoice,
  canTellomiUnpin,
  getTellomiPinChoices,
} from '../../util/tellomiPinChoice.std.ts';

// ADR-0081 §4.6, pinned-messages.md 3.1 / 3.5: the same cases as Android's and iOS's `TellomiPinChoice` tests.
describe('tellomiPinChoice', () => {
  describe('getTellomiPinChoices', () => {
    it('offers both of us or me only in a 1:1 chat, with or without the permission', () => {
      assert.deepEqual(
        getTellomiPinChoices({
          isNoteToSelf: false,
          isGroup: false,
          canPinForEveryone: true,
        }),
        [TellomiPinChoice.ForBoth, TellomiPinChoice.ForMe]
      );
      assert.deepEqual(
        getTellomiPinChoices({
          isNoteToSelf: false,
          isGroup: false,
          canPinForEveryone: false,
        }),
        [TellomiPinChoice.ForBoth, TellomiPinChoice.ForMe],
        'pinning in a 1:1 chat needs no permission'
      );
    });

    it('offers notify, silent and me only in a group with the permission', () => {
      assert.deepEqual(
        getTellomiPinChoices({
          isNoteToSelf: false,
          isGroup: true,
          canPinForEveryone: true,
        }),
        [
          TellomiPinChoice.ForEveryone,
          TellomiPinChoice.ForEveryoneSilent,
          TellomiPinChoice.ForMe,
        ]
      );
    });

    it('offers only me in a group without the permission', () => {
      assert.deepEqual(
        getTellomiPinChoices({
          isNoteToSelf: false,
          isGroup: true,
          canPinForEveryone: false,
        }),
        [TellomiPinChoice.ForMe]
      );
    });

    it('does not ask in Note to Self', () => {
      assert.isNull(
        getTellomiPinChoices({
          isNoteToSelf: true,
          isGroup: false,
          canPinForEveryone: true,
        })
      );
    });
  });

  describe('canTellomiUnpin', () => {
    it('always lets me unpin a pin for me only', () => {
      assert.isTrue(
        canTellomiUnpin({
          isPinnedForMe: true,
          canPinForEveryone: false,
          isInactiveGroup: true,
        })
      );
    });

    it('needs the permission and an active group for any other pin', () => {
      assert.isTrue(
        canTellomiUnpin({
          isPinnedForMe: false,
          canPinForEveryone: true,
          isInactiveGroup: false,
        })
      );
      assert.isFalse(
        canTellomiUnpin({
          isPinnedForMe: false,
          canPinForEveryone: false,
          isInactiveGroup: false,
        })
      );
      assert.isFalse(
        canTellomiUnpin({
          isPinnedForMe: false,
          canPinForEveryone: true,
          isInactiveGroup: true,
        })
      );
    });
  });
});
