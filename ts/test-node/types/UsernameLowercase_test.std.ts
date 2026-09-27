// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import * as sinon from 'sinon';

import {
  ReserveUsernameError,
  formatUsernameForDisplay,
  planUsernameReservation,
} from '../../types/Username.std.ts';
import {
  LOWERCASED_HINT_MS,
  createTemporaryFlag,
  lowercaseNicknameInput,
} from '../../util/tellomiUsernameInput.std.ts';

// Tellomi（ADR-0066 §6.1b，owner 2026-09-27）：用户名一律小写——输入时当场转小写、光标不跳，规则提示短暂换成
// 「已自动转成小写」约 2 秒；所有地方显示小写（老数据只在显示时转）；发给 libsignal 的 nickname 也是小写。
describe('Username lowercase (ADR-0066 §6.1b)', () => {
  describe('formatUsernameForDisplay', () => {
    it('shows the fixed-discriminator nickname in lowercase', () => {
      assert.strictEqual(formatUsernameForDisplay('KaiXin.01'), 'kaixin');
      assert.strictEqual(formatUsernameForDisplay('kaixin.01'), 'kaixin');
    });

    it('shows any other discriminator in full, in lowercase', () => {
      assert.strictEqual(formatUsernameForDisplay('KaiXin.57'), 'kaixin.57');
      assert.strictEqual(
        formatUsernameForDisplay('Tellomi.101'),
        'tellomi.101'
      );
    });

    it('lowercases strings without a discriminator too', () => {
      assert.strictEqual(formatUsernameForDisplay('KaiXin'), 'kaixin');
    });
  });

  describe('lowercaseNicknameInput', () => {
    it('lowercases a typed capital and keeps the caret where it was', () => {
      // "kai|" + typed "X" → "kaiX|xin"
      assert.deepStrictEqual(
        lowercaseNicknameInput({
          value: 'kaiXxin',
          selectionStart: 4,
          selectionEnd: 4,
        }),
        { value: 'kaixxin', selectionStart: 4, selectionEnd: 4, changed: true }
      );
    });

    it('lowercases a paste in the middle and keeps the caret after the pasted text', () => {
      // "ab|cd" + paste "KaiXin" → "abKaiXin|cd"
      assert.deepStrictEqual(
        lowercaseNicknameInput({
          value: 'abKaiXincd',
          selectionStart: 8,
          selectionEnd: 8,
        }),
        {
          value: 'abkaixincd',
          selectionStart: 8,
          selectionEnd: 8,
          changed: true,
        }
      );
    });

    it('keeps a selection range as it is', () => {
      assert.deepStrictEqual(
        lowercaseNicknameInput({
          value: 'ABCDEF',
          selectionStart: 1,
          selectionEnd: 4,
        }),
        { value: 'abcdef', selectionStart: 1, selectionEnd: 4, changed: true }
      );
    });

    it('leaves lowercase input untouched', () => {
      assert.deepStrictEqual(
        lowercaseNicknameInput({
          value: 'kaixin_2',
          selectionStart: 8,
          selectionEnd: 8,
        }),
        {
          value: 'kaixin_2',
          selectionStart: 8,
          selectionEnd: 8,
          changed: false,
        }
      );
    });

    it('does not delete or change other invalid characters (they get the inline error)', () => {
      const result = lowercaseNicknameInput({
        value: 'Kai Xin-开心.ÉÀ',
        selectionStart: 3,
        selectionEnd: 3,
      });
      assert.strictEqual(result.value, 'kai xin-开心.ÉÀ');
      assert.strictEqual(result.value.length, 'Kai Xin-开心.ÉÀ'.length);
      assert.strictEqual(result.selectionStart, 3);
      assert.isTrue(result.changed);

      assert.isFalse(
        lowercaseNicknameInput({
          value: 'kai xin-开心.ÉÀ',
          selectionStart: 0,
          selectionEnd: 0,
        }).changed
      );
    });
  });

  describe('createTemporaryFlag (the “已自动转成小写” hint)', () => {
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      clock = sandbox.useFakeTimers();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('shows for about 2 seconds, then restores the rule hint', () => {
      assert.strictEqual(LOWERCASED_HINT_MS, 2000);
      const states: Array<boolean> = [];
      const flag = createTemporaryFlag(LOWERCASED_HINT_MS, on =>
        states.push(on)
      );

      flag.trigger();
      assert.deepStrictEqual(states, [true]);
      clock.tick(1999);
      assert.deepStrictEqual(states, [true]);
      clock.tick(1);
      assert.deepStrictEqual(states, [true, false]);
    });

    it('restarts the 2 seconds on every new capital', () => {
      const states: Array<boolean> = [];
      const flag = createTemporaryFlag(2000, on => states.push(on));

      flag.trigger();
      clock.tick(1500);
      flag.trigger();
      clock.tick(1500);
      assert.deepStrictEqual(states, [true]);
      clock.tick(500);
      assert.deepStrictEqual(states, [true, false]);
    });

    it('stops quietly when disposed (editor closed)', () => {
      const states: Array<boolean> = [];
      const flag = createTemporaryFlag(2000, on => states.push(on));
      flag.trigger();
      flag.dispose();
      clock.tick(5000);
      assert.deepStrictEqual(states, [true]);
    });
  });

  describe('planUsernameReservation', () => {
    it('sends the nickname to libsignal in lowercase', () => {
      assert.deepStrictEqual(planUsernameReservation('KaiXin', undefined), {
        kind: 'reserve',
        candidates: [{ nickname: 'kaixin', discriminator: '01' }],
      });
      assert.deepStrictEqual(planUsernameReservation('KAIXIN', 'kaixin.37'), {
        kind: 'reserve',
        candidates: [{ nickname: 'kaixin', discriminator: '01' }],
      });
    });

    it('turns an old mixed-case `.01` username into lowercase on the case-only path', () => {
      // The new username (and the username-link ciphertext made from it in confirmUsername) is lowercase.
      assert.deepStrictEqual(planUsernameReservation('kaixin', 'KaiXin.01'), {
        kind: 'caseChange',
        username: 'kaixin.01',
      });
      assert.deepStrictEqual(planUsernameReservation('KaiXin', 'kaixin.01'), {
        kind: 'caseChange',
        username: 'kaixin.01',
      });
    });

    it('still refuses a nickname that does not start with a letter', () => {
      assert.deepStrictEqual(planUsernameReservation('_KaiXin', undefined), {
        kind: 'invalid',
        error: ReserveUsernameError.CheckStartingCharacter,
      });
    });
  });
});
