// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { cwd } from 'node:process';

import type { WritableDB } from '../../../sql/Interface.std.ts';
import { setupTests } from '../../../sql/Server.node.ts';
import {
  appendPinnedMessage,
  deletePinnedMessageByMessageId,
  getAllPinnedMessages,
} from '../../../sql/server/pinnedMessages.std.ts';
import { createDB, insertData } from '../helpers.node.ts';
import { isTellomiPinnedForMe } from '../../../types/PinnedMessage.std.ts';
import { TimestampMs } from '@signalapp/types';

// ADR-0081 §4.3: a pin for me only is an ordinary pinnedMessages row, marked in tellomiPinnedForMe. Pinning the message for
// both of us replaces the row and makes it ordinary again. Someone else's unpin leaves it alone; my own "for me only"
// unpin takes away only that; any other unpin takes either. The same rules as iOS and Android.
describe('Tellomi: pins for me only (sql/server/pinnedMessages)', () => {
  let db: WritableDB;

  beforeEach(() => {
    db = createDB();
    setupTests(db, { userDataPath: cwd() });
    insertData(db, 'conversations', [{ id: 'c1' }]);
    insertData(db, 'messages', [
      { id: 'm1', conversationId: 'c1' },
      { id: 'm2', conversationId: 'c1' },
    ]);
  });

  afterEach(() => {
    db.close();
  });

  function pin(messageId: string, pinnedAt: number, tellomiForMe: boolean) {
    return appendPinnedMessage(db, 3, {
      conversationId: 'c1',
      messageId,
      pinnedAt: TimestampMs.fromNumber(pinnedAt),
      expiresAt: null,
      tellomiForMe,
    });
  }

  function forMeByMessage(): Record<string, boolean> {
    return Object.fromEntries(
      getAllPinnedMessages(db).map(row => [
        row.messageId,
        isTellomiPinnedForMe(row),
      ])
    );
  }

  it('marks a pin for me only, and a newer pin for both of us makes it ordinary', () => {
    pin('m1', 1, true);
    pin('m2', 2, false);
    assert.deepEqual(forMeByMessage(), { m1: true, m2: false });

    pin('m1', 3, false);
    assert.deepEqual(forMeByMessage(), { m1: false, m2: false });
  });

  it("someone else's unpin leaves my pin for me alone", () => {
    pin('m1', 1, true);
    pin('m2', 2, false);

    assert.isNull(deletePinnedMessageByMessageId(db, 'm1', 'keepPinForMe'));
    assert.isNotNull(deletePinnedMessageByMessageId(db, 'm2', 'keepPinForMe'));
    assert.deepEqual(forMeByMessage(), { m1: true });
  });

  it('my unpin for me only takes away only a pin for me', () => {
    pin('m1', 1, true);
    pin('m2', 2, false);

    assert.isNull(deletePinnedMessageByMessageId(db, 'm2', 'onlyPinForMe'));
    assert.isNotNull(deletePinnedMessageByMessageId(db, 'm1', 'onlyPinForMe'));
    assert.deepEqual(forMeByMessage(), { m2: false });
  });

  it('any other unpin takes either, as upstream', () => {
    pin('m1', 1, true);
    pin('m2', 2, false);

    assert.isNotNull(deletePinnedMessageByMessageId(db, 'm1'));
    assert.isNotNull(deletePinnedMessageByMessageId(db, 'm2', 'any'));
    assert.deepEqual(forMeByMessage(), {});
  });
});
