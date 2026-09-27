// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { notificationService } from '../../services/notifications.preload.ts';
import { itemStorage } from '../../textsecure/Storage.preload.ts';
import type { StorageInterface } from '../../types/Storage.d.ts';
import type { LocalizerType } from '../../types/Util.std.ts';
import { NotificationType } from '../../types/notifications.std.ts';

// Tellomi（tellomi/tellomi#1414，需求 §3.2 安全要求）：「已退出登录」期间通知里不许出现任何会话内容——
// 不管是消息走的 add()（防抖后再弹），还是通话走的 notify()（直接弹），都不弹。没有这个标记时照旧弹。
describe('notifications while logged out (tellomi/tellomi#1414)', () => {
  let shown: Array<{ title: string; body?: string }>;
  let items: Record<string, unknown>;
  let saved: {
    Notification: unknown;
    IPC: unknown;
    SignalContext: unknown;
  };

  const i18n = ((key: string) => `[${key}]`) as unknown as LocalizerType;

  beforeEach(() => {
    shown = [];
    items = {};
    saved = {
      Notification: window.Notification,
      IPC: window.IPC,
      SignalContext: window.SignalContext,
    };

    class RecordingNotification {
      public onclick: unknown;
      constructor(title: string, options?: { body?: string }) {
        shown.push({ title, body: options?.body });
      }
      public close(): void {
        // nothing
      }
    }
    window.Notification =
      RecordingNotification as unknown as typeof Notification;
    window.IPC = {
      drawAttention: () => undefined,
      showWindowsNotification: async (data: {
        heading: string;
        body: string;
      }) => {
        shown.push({ title: data.heading, body: data.body });
      },
      clearAllWindowsNotifications: async () => undefined,
    } as unknown as typeof window.IPC;
    window.SignalContext = {
      ...(saved.SignalContext as typeof window.SignalContext),
      activeWindowService: { isActive: () => false },
    } as unknown as typeof window.SignalContext;

    notificationService.initialize({
      i18n,
      storage: {
        get: (key: string, defaultValue?: unknown) =>
          key in items ? items[key] : defaultValue,
      } as unknown as StorageInterface,
    });
    // 不用 enable()：它会排一个 1 秒后的防抖更新，跑到别的测试里去
    notificationService.isEnabled = true;
  });

  afterEach(() => {
    // fastClear 立即更新（不防抖），趁上面的替身还在
    notificationService.fastClear();
    notificationService.isEnabled = false;
    window.Notification = saved.Notification as typeof Notification;
    window.IPC = saved.IPC as typeof window.IPC;
    window.SignalContext = saved.SignalContext as typeof window.SignalContext;
  });

  after(() => {
    notificationService.initialize({
      i18n: window.SignalContext.i18n,
      storage: itemStorage,
    });
  });

  function addMessageNotification() {
    notificationService.add({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      message: 'dinner at 7',
      senderTitle: 'Alice',
      sentAt: 1,
      type: NotificationType.Message,
      isExpiringMessage: false,
    });
  }

  // add() 在服务里防抖 1 秒才真正弹（lodash 的 debounce 在模块加载时就拿走了 setTimeout，假时钟管不到）
  async function waitForDebounce(): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, 1200);
    });
  }

  function callNotify() {
    notificationService.notify({
      conversationId: 'conversation-1',
      message: 'Incoming call',
      sentAt: 1,
      silent: true,
      title: 'Alice',
      type: NotificationType.IncomingCall,
    });
  }

  it('logged out: a new message shows nothing', async () => {
    items.tellomiLoggedOut = true;

    addMessageNotification();
    await waitForDebounce();

    assert.deepStrictEqual(shown, []);
  });

  it('logged out: a call notification shows nothing', () => {
    items.tellomiLoggedOut = true;

    callNotify();

    assert.deepStrictEqual(shown, []);
  });

  it('not logged out: a new message is shown as upstream', async () => {
    addMessageNotification();
    await waitForDebounce();

    assert.deepStrictEqual(shown, [{ title: 'Alice', body: 'dinner at 7' }]);
  });

  it('not logged out: a call notification is shown as upstream', () => {
    callNotify();

    assert.deepStrictEqual(shown, [{ title: 'Alice', body: 'Incoming call' }]);
  });
});
