// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { cwd } from 'node:process';
import { assert } from 'chai';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { DataReader, DataWriter, setupTests } from '../../sql/Server.node.ts';
import { STORAGE_KEYS_TO_PRESERVE_AFTER_UNLINK } from '../../types/StorageKeys.std.ts';
import type { TellomiLoggedOutStorage } from '../../util/tellomiLoggedOut.std.ts';
import {
  clearTellomiLoggedOut,
  markTellomiLoggedOut,
} from '../../util/tellomiLoggedOut.std.ts';
import { createDB, getTableData, insertData } from './helpers.node.ts';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4）：Desktop「退出登录（保留聊天记录）」删掉服务端的本机设备后，
// 走现有的 unlinkAndDisconnect，它清本地配置用的是 removeAllConfiguration(isPrimary=false)。这里钉住两件事：
// 1. 会话和消息都留着（需求 1.1：被取消关联后会话与消息保留）；
// 2. 判断「重新关联的是不是同一个账号」要用的 uuid_id / number_id 留着——同一个账号关联回来走
//    shouldDeleteConfigOnly、会话回来；另一个账号走 removeAllData 清空（AccountManager.createAccount，
//    判断本身由 isRelinkingToSameAccount_test 覆盖）。
// 登录凭据（password）和本机注册完成标记要清掉，否则本机不会停在「未连接」。
describe('SQL/removeAllConfiguration on a linked device (tellomi/tellomi#1414)', () => {
  let db: WritableDB;

  const ACI = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  beforeEach(() => {
    db = createDB();
    setupTests(db, { userDataPath: cwd() });

    insertData(db, 'conversations', [
      {
        id: 'conversation-1',
        type: 'private',
        json: { id: 'conversation-1', type: 'private', name: 'Alice' },
      },
      {
        id: 'group-1',
        type: 'group',
        json: { id: 'group-1', type: 'group', name: 'Family' },
      },
    ]);
    insertData(db, 'messages', [
      {
        id: 'message-1',
        conversationId: 'conversation-1',
        body: 'hello',
        json: {
          id: 'message-1',
          conversationId: 'conversation-1',
          body: 'hello',
        },
      },
      {
        id: 'message-2',
        conversationId: 'group-1',
        body: 'dinner at 7',
        json: {
          id: 'message-2',
          conversationId: 'group-1',
          body: 'dinner at 7',
        },
      },
    ]);

    DataWriter.createOrUpdateItem(db, { id: 'uuid_id', value: `${ACI}.3` });
    DataWriter.createOrUpdateItem(db, {
      id: 'number_id',
      value: '+8613800000000.3',
    });
    DataWriter.createOrUpdateItem(db, { id: 'password', value: 'secret' });
    DataWriter.createOrUpdateItem(db, {
      id: 'chromiumRegistrationDone',
      value: '',
    });
    DataWriter.createOrUpdateItem(db, {
      id: 'chromiumRegistrationDoneEver',
      value: '',
    });
  });

  afterEach(() => {
    db.close();
  });

  function itemIds(): Array<string> {
    return Object.keys(DataReader.getAllItems(db));
  }

  it('keeps every conversation and message', () => {
    DataWriter.removeAllConfiguration(db, false);

    assert.sameMembers(
      getTableData(db, 'conversations').map(row => row.id),
      ['conversation-1', 'group-1']
    );
    assert.sameMembers(
      getTableData(db, 'messages').map(row => row.id),
      ['message-1', 'message-2']
    );
    assert.sameMembers(
      getTableData(db, 'messages').map(row => row.body),
      ['dinner at 7', 'hello']
    );
  });

  it('keeps the account ids used to recognise a relink to the same account', () => {
    DataWriter.removeAllConfiguration(db, false);

    const items = DataReader.getAllItems(db);
    assert.strictEqual(items.uuid_id, `${ACI}.3`);
    assert.strictEqual(items.number_id, '+8613800000000.3');
    assert.include(itemIds(), 'chromiumRegistrationDoneEver');
  });

  it('drops the login credentials and the "registration done" flag', () => {
    DataWriter.removeAllConfiguration(db, false);

    const ids = itemIds();
    assert.notInclude(ids, 'password');
    assert.notInclude(ids, 'chromiumRegistrationDone');
  });

  // 需求 §3.2 安全要求：「退出登录」记下的 tellomiLoggedOut 要一直留到重新关联完成。
  describe('the "logged out" flag (tellomiLoggedOut)', () => {
    // 和 itemStorage 一样的 get / put / remove，落在这个测试库的 items 表上
    function dbStorage(): TellomiLoggedOutStorage {
      return {
        get: key => DataReader.getAllItems(db)[key],
        put: async (key, value) => {
          DataWriter.createOrUpdateItem(db, { id: key, value });
        },
        remove: async key => {
          DataWriter.removeItemById(db, key);
        },
      };
    }

    it('is on the list of items kept after an unlink', () => {
      assert.include(
        STORAGE_KEYS_TO_PRESERVE_AFTER_UNLINK as ReadonlyArray<string>,
        'tellomiLoggedOut'
      );
    });

    it('survives the unlink cleanup (ours, or the one the server disconnect triggers)', async () => {
      await markTellomiLoggedOut(dbStorage());
      DataWriter.removeAllConfiguration(db, false);

      assert.isTrue(DataReader.getAllItems(db).tellomiLoggedOut);
    });

    it('same account relinked: still set while linking, cleared when done, chats all back', async () => {
      const storage = dbStorage();
      await markTellomiLoggedOut(storage);
      DataWriter.removeAllConfiguration(db, false);

      // AccountManager.createAccount, same account → removeAllConfiguration again (config only)
      DataWriter.removeAllConfiguration(db, false);
      assert.isTrue(
        DataReader.getAllItems(db).tellomiLoggedOut,
        'a link that fails half-way must not reveal the chats'
      );

      // AccountManager #registrationDone
      await clearTellomiLoggedOut(storage);

      assert.notInclude(itemIds(), 'tellomiLoggedOut');
      assert.sameMembers(
        getTableData(db, 'conversations').map(row => row.id),
        ['conversation-1', 'group-1']
      );
      assert.sameMembers(
        getTableData(db, 'messages').map(row => row.id),
        ['message-1', 'message-2']
      );
    });

    it('another account linked: everything wiped as upstream, flag gone', async () => {
      const storage = dbStorage();
      await markTellomiLoggedOut(storage);
      DataWriter.removeAllConfiguration(db, false);

      // AccountManager.createAccount, different account → removeAllData
      DataWriter.removeAll(db);
      // AccountManager #registrationDone
      await clearTellomiLoggedOut(storage);

      assert.notInclude(itemIds(), 'tellomiLoggedOut');
      assert.deepStrictEqual(getTableData(db, 'conversations'), []);
      assert.deepStrictEqual(getTableData(db, 'messages'), []);
    });

    it('an unlink by the phone (upstream path) never sets it', () => {
      DataWriter.removeAllConfiguration(db, false);

      assert.notInclude(itemIds(), 'tellomiLoggedOut');
    });
  });
});
