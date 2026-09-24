// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import * as Username from '../../util/Username.dom.ts';
import { updateRemoteConfig } from '../../test-helpers/RemoteConfigStub.dom.ts';
import {
  FIXED_DISCRIMINATOR,
  RENAME_COOLDOWN_MIN_RETRY_AFTER_SECS,
  ReserveUsernameError,
  USERNAME_HOLD_DAYS,
  formatUsernameForDisplay,
  getRenameCooldownDays,
  getUsernameSaveConfirmation,
  isRenameCooldown,
  isWithinUsernameHold,
  planUsernameReservation,
  startsWithLetter,
  withFixedDiscriminator,
} from '../../types/Username.std.ts';

describe('Username', () => {
  describe('isUsernameValid', () => {
    const { isUsernameValid } = Username;

    it('returns false for missing discriminator', () => {
      assert.isFalse(isUsernameValid('use'));
      assert.isFalse(isUsernameValid('user'));
      assert.isFalse(isUsernameValid('usern'));
      assert.isFalse(isUsernameValid('usern.'));
    });

    it('matches valid username searches', () => {
      assert.isTrue(isUsernameValid('username.01'));
      assert.isTrue(isUsernameValid('username.12'));
      assert.isTrue(isUsernameValid('xyz.568'));
      assert.isTrue(isUsernameValid('numbered9.34'));
      assert.isTrue(isUsernameValid('u12.34'));
      assert.isTrue(isUsernameValid('with_underscore.56'));
      assert.isTrue(isUsernameValid('username_with_32_characters_1234.45'));
    });

    it('does not match when then username starts with a number', () => {
      assert.isFalse(isUsernameValid('1user.12'));
      assert.isFalse(isUsernameValid('9user_name.12'));
    });

    it('does not match usernames shorter than 3 characters or longer than 32', () => {
      assert.isFalse(isUsernameValid('us.12'));
      assert.isFalse(isUsernameValid('username_with_33_characters_12345.67'));
    });

    it('does not match something that looks like a phone number', () => {
      assert.isFalse(isUsernameValid('+'));
      assert.isFalse(isUsernameValid('2223'));
      assert.isFalse(isUsernameValid('+3'));
      assert.isFalse(isUsernameValid('+234234234233'));
    });

    it('does not match invalid discriminators', () => {
      assert.isFalse(isUsernameValid('username.0'));
      assert.isFalse(isUsernameValid('username.00'));
      assert.isFalse(isUsernameValid('username.000'));
      assert.isFalse(isUsernameValid('username.001'));
      assert.isFalse(isUsernameValid('username.012'));
    });

    // Tellomi (TR-ID-01, tellomi/tellomi#1181): the server sends global.nicknames.max = 20, which limits new usernames
    // only. Existing ones up to the protocol's 32 must stay valid, or ConversationModel.updateUsername drops them.
    describe('with global.nicknames.max = 20', () => {
      beforeEach(async () => {
        await updateRemoteConfig([
          { name: 'global.nicknames.min', value: '3' },
          { name: 'global.nicknames.max', value: '20' },
        ]);
      });

      afterEach(async () => {
        await updateRemoteConfig([]);
      });

      it('still accepts existing 21-32 character nicknames', () => {
        assert.strictEqual(Username.getMaxNickname(), 20);
        assert.isTrue(isUsernameValid('abcdefghijklmnopqrstu.01'));
        assert.isTrue(isUsernameValid('username_with_32_characters_1234.45'));
        assert.isFalse(isUsernameValid('username_with_33_characters_12345.67'));
      });
    });
  });

  describe('getUsernameFromSearch', () => {
    const { getUsernameFromSearch } = Username;

    // Tellomi (ADR-0066): a bare nickname is looked up as `<nickname>.01`, the only discriminator Tellomi sets.
    it('completes a nickname without discriminator with .01', () => {
      assert.strictEqual(getUsernameFromSearch('use'), 'use.01');
      assert.strictEqual(getUsernameFromSearch('user'), 'user.01');
      assert.strictEqual(getUsernameFromSearch('usern'), 'usern.01');
      assert.strictEqual(getUsernameFromSearch('KaiXin'), 'KaiXin.01');
    });

    it('leaves a trailing dot alone (not a username yet)', () => {
      assert.strictEqual(getUsernameFromSearch('usern.'), 'usern.');
    });

    it('matches and strips leading @', () => {
      assert.strictEqual(getUsernameFromSearch('@user'), 'user.01');
      assert.strictEqual(getUsernameFromSearch('@user.'), 'user.');
      assert.strictEqual(getUsernameFromSearch('@user.01'), 'user.01');
    });

    it('matches valid username searches', () => {
      assert.strictEqual(getUsernameFromSearch('username.12'), 'username.12');
      assert.strictEqual(getUsernameFromSearch('xyz.568'), 'xyz.568');
      assert.strictEqual(getUsernameFromSearch('numbered9.34'), 'numbered9.34');
      assert.strictEqual(getUsernameFromSearch('u12.34'), 'u12.34');
      assert.strictEqual(
        getUsernameFromSearch('with_underscore.56'),
        'with_underscore.56'
      );
      assert.strictEqual(
        getUsernameFromSearch('username_with_32_characters_1234.45'),
        'username_with_32_characters_1234.45'
      );
    });

    it('trims whitespace at beginning or end', () => {
      assert.strictEqual(getUsernameFromSearch('  username.12'), 'username.12');
      assert.strictEqual(getUsernameFromSearch('xyz.568  '), 'xyz.568');
      assert.strictEqual(
        getUsernameFromSearch('\t\t  numbered9.34 \t\t '),
        'numbered9.34'
      );
    });

    it('does not match when then username starts with a number', () => {
      assert.isUndefined(getUsernameFromSearch('1user.12'));
      assert.isUndefined(getUsernameFromSearch('9user_name.12'));
    });

    it('does not match usernames shorter than 3 characters or longer than 32', () => {
      assert.isUndefined(getUsernameFromSearch('us.12'));
      assert.isUndefined(
        getUsernameFromSearch('username_with_33_characters_12345.67')
      );
    });

    it('does not match something that looks like a phone number', () => {
      assert.isUndefined(getUsernameFromSearch('+'));
      assert.isUndefined(getUsernameFromSearch('2223'));
      assert.isUndefined(getUsernameFromSearch('+3'));
      assert.isUndefined(getUsernameFromSearch('+234234234233'));
    });
  });

  describe('probablyAUsername', () => {
    const { isProbablyAUsername: probablyAUsername } = Username;

    it('returns true if it starts with @', () => {
      assert.isTrue(probablyAUsername('@'));
      assert.isTrue(probablyAUsername('@5551115555'));
      assert.isTrue(probablyAUsername('@.324'));
    });

    it('returns true if it ends with a discriminator', () => {
      assert.isTrue(probablyAUsername('someone.00'));
      assert.isTrue(probablyAUsername('d2423423.04'));
      assert.isTrue(probablyAUsername('e_f.04'));
    });

    it('returns true if it starts or ends with whitespace', () => {
      assert.isTrue(probablyAUsername('  @user\t  '));
    });

    it('returns false if just a discriminator', () => {
      assert.isFalse(probablyAUsername('.01'));
      assert.isFalse(probablyAUsername('.99'));
    });

    it('returns false for normal searches', () => {
      assert.isFalse(probablyAUsername('group'));
      assert.isFalse(probablyAUsername('climbers'));
      assert.isFalse(probablyAUsername('sarah'));
      assert.isFalse(probablyAUsername('john'));
    });

    it('returns false for usernames starting with a number', () => {
      assert.isFalse(probablyAUsername('1user.01'));
      assert.isFalse(probablyAUsername('9name.99'));
    });

    it('returns false for usernames shorter than 3 characters or longer than 32', () => {
      assert.isFalse(probablyAUsername('us.12'));
      assert.isFalse(probablyAUsername('username_with_33_characters_12345.67'));
    });

    it('returns false for something that looks like a phone number', () => {
      assert.isFalse(probablyAUsername('+'));
      assert.isFalse(probablyAUsername('2223'));
      assert.isFalse(probablyAUsername('+3'));
      assert.isFalse(probablyAUsername('+234234234233'));
    });
  });
});

// Tellomi (ADR-0066): the discriminator is fixed at `01` and hidden; every other one is shown in full.
describe('Username (Tellomi fixed discriminator)', () => {
  it('fixes the discriminator at 01', () => {
    assert.strictEqual(FIXED_DISCRIMINATOR, '01');
  });

  describe('formatUsernameForDisplay', () => {
    it('drops only the fixed discriminator', () => {
      assert.strictEqual(formatUsernameForDisplay('kaixin.01'), 'kaixin');
      assert.strictEqual(formatUsernameForDisplay('KaiXin.01'), 'KaiXin');
    });

    // ADR-0066 §九, the reverse case: someone else's `kaixin.57` must never be shown as `kaixin`.
    it('shows any other discriminator in full', () => {
      assert.strictEqual(formatUsernameForDisplay('kaixin.57'), 'kaixin.57');
      assert.strictEqual(formatUsernameForDisplay('kaixin.101'), 'kaixin.101');
      assert.strictEqual(formatUsernameForDisplay('kaixin.001'), 'kaixin.001');
      assert.strictEqual(formatUsernameForDisplay('kaixin.010'), 'kaixin.010');
    });

    it('leaves strings without a discriminator alone', () => {
      assert.strictEqual(formatUsernameForDisplay('kaixin'), 'kaixin');
      assert.strictEqual(formatUsernameForDisplay('kaixin.'), 'kaixin.');
    });
  });

  describe('withFixedDiscriminator', () => {
    it('completes a bare nickname with .01', () => {
      assert.strictEqual(withFixedDiscriminator('kaixin'), 'kaixin.01');
      assert.strictEqual(withFixedDiscriminator('KaiXin'), 'KaiXin.01');
    });

    it('keeps an existing discriminator as typed', () => {
      assert.strictEqual(withFixedDiscriminator('kaixin.01'), 'kaixin.01');
      assert.strictEqual(withFixedDiscriminator('kaixin.57'), 'kaixin.57');
    });

    it('does not turn a trailing dot into a username', () => {
      assert.strictEqual(withFixedDiscriminator('kaixin.'), 'kaixin.');
    });

    it('is idempotent', () => {
      assert.strictEqual(
        withFixedDiscriminator(withFixedDiscriminator('kaixin')),
        'kaixin.01'
      );
    });
  });

  // ADR-0066 §六: libsignal alone would register `_kaixin.01`; new nicknames must start with a letter.
  describe('startsWithLetter', () => {
    it('accepts a leading letter of either case', () => {
      assert.isTrue(startsWithLetter('kaixin'));
      assert.isTrue(startsWithLetter('Kaixin_2'));
      assert.isTrue(startsWithLetter('z__'));
    });

    it('refuses a leading underscore, digit or anything else', () => {
      assert.isFalse(startsWithLetter('_kaixin'));
      assert.isFalse(startsWithLetter('9kaixin'));
      assert.isFalse(startsWithLetter('开心'));
      assert.isFalse(startsWithLetter(''));
    });
  });

  // ADR-0066 §6.2: what reserveUsername sends (tellomi/tellomi#1247 — Pro's review of Signal-Desktop#2 asked for these
  // to be pinned by tests: they used to be inline and nothing went red when they changed).
  describe('planUsernameReservation', () => {
    it('reserves exactly one candidate, the nickname with 01', () => {
      for (const previous of [undefined, 'hk881qa.01', 'kaixin.37']) {
        assert.deepStrictEqual(planUsernameReservation('newname', previous), {
          kind: 'reserve',
          candidates: [{ nickname: 'newname', discriminator: '01' }],
        });
      }
    });

    it('takes the case-only shortcut only when the current discriminator is 01', () => {
      assert.deepStrictEqual(planUsernameReservation('KaiXin', 'kaixin.01'), {
        kind: 'caseChange',
        username: 'KaiXin.01',
      });
      // An old `.37` typing its nickname again moves to `.01`: a real reservation, not a case change.
      assert.deepStrictEqual(planUsernameReservation('KAIXIN', 'kaixin.37'), {
        kind: 'reserve',
        candidates: [{ nickname: 'KAIXIN', discriminator: '01' }],
      });
    });

    it('refuses a new nickname that does not start with a letter', () => {
      for (const nickname of ['_kaixin', '9kaixin']) {
        assert.deepStrictEqual(planUsernameReservation(nickname, undefined), {
          kind: 'invalid',
          error: ReserveUsernameError.CheckStartingCharacter,
        });
      }
    });

    it('lets an existing `_` username change its case', () => {
      assert.deepStrictEqual(planUsernameReservation('_KaiXin', '_kaixin.01'), {
        kind: 'caseChange',
        username: '_KaiXin.01',
      });
    });

    it('leaves an empty nickname to libsignal', () => {
      assert.deepStrictEqual(planUsernameReservation('', undefined), {
        kind: 'reserve',
        candidates: [{ nickname: '', discriminator: '01' }],
      });
    });
  });

  // ADR-0066 §6.2: a deleted username stays held for its owner, and setting any username while it is held starts the
  // rename cooldown, so the editor warns before it (tellomi/tellomi#1247).
  describe('username hold and save confirmation', () => {
    const now = Date.UTC(2026, 8, 24, 12);
    const day = 24 * 60 * 60 * 1000;

    it('treats a deletion as held for USERNAME_HOLD_DAYS', () => {
      assert.strictEqual(USERNAME_HOLD_DAYS, 30);
      assert.isFalse(isWithinUsernameHold(undefined, now));
      assert.isTrue(isWithinUsernameHold(now - day, now));
      assert.isTrue(isWithinUsernameHold(now - 30 * day + 1, now));
      assert.isFalse(isWithinUsernameHold(now - 30 * day, now));
      // Clock moved back after the deletion: warn rather than stay silent.
      assert.isTrue(isWithinUsernameHold(now + day, now));
    });

    it('picks the right warning before saving', () => {
      const base = { isCaseChangeOnly: false, deletedAt: undefined, now };
      assert.strictEqual(
        getUsernameSaveConfirmation({ ...base, currentUsername: undefined }),
        'none'
      );
      assert.strictEqual(
        getUsernameSaveConfirmation({ ...base, currentUsername: 'kaixin.01' }),
        'change'
      );
      assert.strictEqual(
        getUsernameSaveConfirmation({
          ...base,
          currentUsername: 'kaixin.01',
          isCaseChangeOnly: true,
        }),
        'none'
      );
      assert.strictEqual(
        getUsernameSaveConfirmation({
          ...base,
          currentUsername: undefined,
          deletedAt: now - day,
        }),
        'setAfterDelete'
      );
      assert.strictEqual(
        getUsernameSaveConfirmation({
          ...base,
          currentUsername: undefined,
          deletedAt: now - 31 * day,
        }),
        'none'
      );
    });
  });

  // ADR-0066 §6.2 + tellomi/tellomi#1106: the rules all three clients share for a 429 on reserve.
  describe('rename cooldown', () => {
    it('treats a Retry-After above an hour as the cooldown', () => {
      assert.isFalse(isRenameCooldown(9));
      assert.isFalse(isRenameCooldown(RENAME_COOLDOWN_MIN_RETRY_AFTER_SECS));
      assert.isTrue(isRenameCooldown(RENAME_COOLDOWN_MIN_RETRY_AFTER_SECS + 1));
      assert.isTrue(isRenameCooldown(2591999));
    });

    it('shows whole days, rounded up, at least one', () => {
      assert.strictEqual(getRenameCooldownDays(2591999), 30);
      assert.strictEqual(getRenameCooldownDays(2592000), 30);
      assert.strictEqual(getRenameCooldownDays(86401), 2);
      assert.strictEqual(getRenameCooldownDays(86400), 1);
      assert.strictEqual(getRenameCooldownDays(7200), 1);
      assert.strictEqual(getRenameCooldownDays(0), 1);
    });
  });
});
