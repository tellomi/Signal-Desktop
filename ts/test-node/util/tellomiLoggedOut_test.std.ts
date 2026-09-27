// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { AppViewType } from '../../types/app.std.ts';
import type { TellomiLoggedOutStorage } from '../../util/tellomiLoggedOut.std.ts';
import {
  clearTellomiLoggedOut,
  decideTellomiOpenInbox,
  getTellomiBadgeCount,
  isTellomiLoggedOut,
  markTellomiLoggedOut,
  shouldTellomiStartOnInbox,
} from '../../util/tellomiLoggedOut.std.ts';

// Tellomi（tellomi/tellomi#1414，需求 §3.2 安全要求）：Desktop「退出登录（保留聊天记录）」后本机记一个
// tellomiLoggedOut。它在的时候：启动直接进关联二维码页、任何「打开聊天列表」都改成关联页（已经在关联页就不动）、
// 角标 / 托盘 / 窗口标题的未读数一律 0。重新关联（同一账号或另一个账号）完成时清掉。
// 手机那边取消关联（上游的「未连接」）不记这个标记，聊天列表照旧能看。
describe('tellomiLoggedOut (tellomi/tellomi#1414)', () => {
  function fakeStorage(initial?: boolean): TellomiLoggedOutStorage & {
    value: () => boolean | undefined;
  } {
    let value = initial;
    return {
      get: () => value,
      put: async (_key, next) => {
        value = next;
      },
      remove: async () => {
        value = undefined;
      },
      value: () => value,
    };
  }

  describe('isTellomiLoggedOut', () => {
    it('is true only when the flag is set to true', () => {
      assert.isTrue(isTellomiLoggedOut({ tellomiLoggedOut: true }));
      assert.isFalse(isTellomiLoggedOut({ tellomiLoggedOut: false }));
      assert.isFalse(isTellomiLoggedOut({}));
    });
  });

  describe('mark / clear', () => {
    it('mark persists the flag', async () => {
      const storage = fakeStorage();
      await markTellomiLoggedOut(storage);
      assert.isTrue(storage.value());
    });

    it('clear removes it (registration done, same or another account)', async () => {
      const storage = fakeStorage(true);
      await clearTellomiLoggedOut(storage);
      assert.isUndefined(storage.value());
    });

    it('clear still removes when storage no longer has it (another account: removeAllData reloaded storage, but redux still holds the old value)', async () => {
      const removed: Array<string> = [];
      await clearTellomiLoggedOut({
        get: () => undefined,
        put: async () => undefined,
        remove: async key => {
          removed.push(key);
        },
      });
      assert.deepStrictEqual(removed, ['tellomiLoggedOut']);
    });
  });

  describe('decideTellomiOpenInbox: every way into the chat list', () => {
    it('logged out: anything that would open the chat list opens the link screen instead', () => {
      for (const appView of [
        AppViewType.Blank,
        AppViewType.Inbox,
        AppViewType.Standalone,
      ]) {
        assert.strictEqual(
          decideTellomiOpenInbox({ isLoggedOut: true, appView }),
          'open-relink',
          appView
        );
      }
    });

    it('logged out and already on the link screen: stays there (no way back to the inbox)', () => {
      assert.strictEqual(
        decideTellomiOpenInbox({
          isLoggedOut: true,
          appView: AppViewType.Installer,
        }),
        'stay'
      );
    });

    it('not logged out (including an unlink done by the phone): opens the chat list as upstream', () => {
      for (const appView of Object.values(AppViewType)) {
        assert.strictEqual(
          decideTellomiOpenInbox({ isLoggedOut: false, appView }),
          'open-inbox',
          appView
        );
      }
    });
  });

  describe('shouldTellomiStartOnInbox: the first view on launch', () => {
    it('logged out: starts on the link screen even though this computer was linked before', () => {
      assert.isFalse(
        shouldTellomiStartOnInbox({
          isCoreDataValid: true,
          registrationEverDone: true,
          isLoggedOut: true,
        })
      );
    });

    it('unlinked by the phone (no flag): starts on the chat list, as upstream', () => {
      assert.isTrue(
        shouldTellomiStartOnInbox({
          isCoreDataValid: true,
          registrationEverDone: true,
          isLoggedOut: false,
        })
      );
    });

    it('never linked: link screen, as upstream', () => {
      assert.isFalse(
        shouldTellomiStartOnInbox({
          isCoreDataValid: false,
          registrationEverDone: false,
          isLoggedOut: false,
        })
      );
      assert.isFalse(
        shouldTellomiStartOnInbox({
          isCoreDataValid: true,
          registrationEverDone: false,
          isLoggedOut: false,
        })
      );
    });
  });

  describe('getTellomiBadgeCount: dock badge, tray icon and window title', () => {
    it('logged out: always 0', () => {
      assert.strictEqual(getTellomiBadgeCount(7, true), 0);
      assert.strictEqual(getTellomiBadgeCount(0, true), 0);
    });

    it('otherwise the real unread total', () => {
      assert.strictEqual(getTellomiBadgeCount(7, false), 7);
    });
  });
});
