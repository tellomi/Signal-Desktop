// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { cwd } from 'node:process';

import type { WritableDB } from '../../../sql/Interface.std.ts';
import { setupTests } from '../../../sql/Server.node.ts';
import { getTellomiPinNoticeIdsByTargetSentAt } from '../../../sql/server/tellomiPinNotices.std.ts';
import { createDB, insertData } from '../helpers.node.ts';

// ADR-0081 §4.4: pin chat events are found by the pinned message's timestamp through migration 1805's partial index
// (the query names the index, so it fails if SQLite can't use it).
describe('Tellomi: pin chat events by the pinned message (sql/server/tellomiPinNotices)', () => {
  let db: WritableDB;

  beforeEach(() => {
    db = createDB();
    setupTests(db, { userDataPath: cwd() });
    insertData(db, 'conversations', [{ id: 'c1' }, { id: 'c2' }]);
  });

  afterEach(() => {
    db.close();
  });

  function message(
    id: string,
    conversationId: string,
    type: string,
    targetSentTimestamp: number
  ) {
    const json = {
      id,
      conversationId,
      type,
      pinMessage: { targetAuthorAci: 'aci', targetSentTimestamp },
    };
    return { id, conversationId, type, json };
  }

  it('has the index after migrating', () => {
    const index = db
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE name = 'messages_tellomi_pin_notice_target'",
        { pluck: true }
      )
      .get<string>();
    assert.include(index, "WHERE type IS 'pinned-message-notification'");
  });

  it('finds this conversation’s pin chat events for these timestamps only', () => {
    insertData(db, 'messages', [
      message('pin1', 'c1', 'pinned-message-notification', 1000),
      message('pin2', 'c1', 'pinned-message-notification', 2000),
      message('pin3', 'c1', 'pinned-message-notification', 3000),
      message('otherChat', 'c2', 'pinned-message-notification', 1000),
      message('notAPin', 'c1', 'incoming', 1000),
    ]);

    assert.sameMembers(
      getTellomiPinNoticeIdsByTargetSentAt(db, 'c1', [1000, 3000]),
      ['pin1', 'pin3']
    );
    assert.deepEqual(
      getTellomiPinNoticeIdsByTargetSentAt(db, 'c1', [4000]),
      []
    );
    assert.deepEqual(getTellomiPinNoticeIdsByTargetSentAt(db, 'c1', []), []);
  });
});
