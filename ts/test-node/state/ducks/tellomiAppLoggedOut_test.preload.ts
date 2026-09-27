// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import * as sinon from 'sinon';

import { actions, getEmptyState } from '../../../state/ducks/app.preload.ts';
import type { StateType } from '../../../state/reducer.preload.ts';
import { AppViewType } from '../../../types/app.std.ts';

// Tellomi（tellomi/tellomi#1414，需求 §3.2 安全要求）：app/OPEN_INBOX 是进聊天列表的唯一一道门
// （启动、通知点开、断网时从「关联中」退回、关联完成……都走 openInbox）。本机「已退出登录」时这道门不开：
// 不在关联页就去关联页（发现有的 'setupAsNewDevice'，和左栏「重新关联」同一条路），已经在关联页就不动。
// 没有这个标记（包括被手机取消关联的上游「未连接」）照旧进聊天列表。
describe('app/openInbox while logged out (tellomi/tellomi#1414)', () => {
  type Emitted = Array<string>;

  let savedConversationController: unknown;
  let savedWhisper: unknown;
  let emitted: Emitted;
  let loads: number;

  beforeEach(() => {
    savedConversationController = window.ConversationController;
    savedWhisper = window.Whisper;
    emitted = [];
    loads = 0;
    window.ConversationController = {
      load: async () => {
        loads += 1;
      },
    } as unknown as typeof window.ConversationController;
    window.Whisper = {
      events: {
        emit: (name: string) => {
          emitted.push(name);
          return true;
        },
      },
    } as unknown as typeof window.Whisper;
  });

  afterEach(() => {
    window.ConversationController =
      savedConversationController as typeof window.ConversationController;
    window.Whisper = savedWhisper as typeof window.Whisper;
  });

  async function openInbox({
    tellomiLoggedOut,
    appView,
  }: {
    tellomiLoggedOut?: boolean;
    appView: AppViewType;
  }): Promise<Array<{ type: string }>> {
    const state = {
      app: { ...getEmptyState(), appView },
      items: tellomiLoggedOut == null ? {} : { tellomiLoggedOut },
    } as unknown as StateType;
    const dispatch = sinon.spy();

    await actions.openInbox()(dispatch, () => state, undefined);
    return dispatch.getCalls().map(call => call.args[0]);
  }

  it('logged out, launching (blank screen): goes to the link screen, never to the inbox', async () => {
    const dispatched = await openInbox({
      tellomiLoggedOut: true,
      appView: AppViewType.Blank,
    });
    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(emitted, ['setupAsNewDevice']);
  });

  it('logged out, inbox somehow showing (e.g. notification click): switches to the link screen', async () => {
    const dispatched = await openInbox({
      tellomiLoggedOut: true,
      appView: AppViewType.Inbox,
    });
    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(emitted, ['setupAsNewDevice']);
  });

  it('logged out, already on the link screen (e.g. offline during linking): stays there', async () => {
    const dispatched = await openInbox({
      tellomiLoggedOut: true,
      appView: AppViewType.Installer,
    });
    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(emitted, []);
  });

  it('does not even load conversations into memory for the view while logged out', async () => {
    await openInbox({ tellomiLoggedOut: true, appView: AppViewType.Blank });
    assert.strictEqual(loads, 0);
  });

  it('no flag (unlinked by the phone, or never logged out): opens the inbox as upstream', async () => {
    for (const appView of [
      AppViewType.Blank,
      AppViewType.Installer,
      AppViewType.Inbox,
    ]) {
      emitted = [];
      // oxlint-disable-next-line no-await-in-loop
      const dispatched = await openInbox({ appView });
      assert.deepStrictEqual(dispatched, [{ type: 'app/OPEN_INBOX' }], appView);
      assert.deepStrictEqual(emitted, [], appView);
    }
  });

  it('flag explicitly false: opens the inbox', async () => {
    const dispatched = await openInbox({
      tellomiLoggedOut: false,
      appView: AppViewType.Installer,
    });
    assert.deepStrictEqual(dispatched, [{ type: 'app/OPEN_INBOX' }]);
  });
});
