// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { createDB, updateToVersion } from './helpers.node.ts';

// Tellomi (ADR-0081 §4.3, §4.9): the tellomiPinnedForMe table beside pinnedMessages.
describe('SQL/updateToSchemaVersion1804 (Tellomi)', () => {
  let db: WritableDB;

  beforeEach(() => {
    db = createDB();
  });

  afterEach(() => {
    db.close();
  });

  function hasTable(): boolean {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tellomiPinnedForMe'"
        )
        .get() != null
    );
  }

  it('adds the table after 1803, and a pin row takes its mark with it', () => {
    updateToVersion(db, 1803);
    assert.isFalse(hasTable());

    updateToVersion(db, 1804);
    assert.isTrue(hasTable());

    db.exec(`
      INSERT INTO conversations (id) VALUES ('c1');
      INSERT INTO messages (id, conversationId) VALUES ('m1', 'c1');
      INSERT INTO pinnedMessages (conversationId, messageId, pinnedAt) VALUES ('c1', 'm1', 1);
      INSERT INTO tellomiPinnedForMe (pinnedMessageId) VALUES (1);
      DELETE FROM pinnedMessages WHERE id = 1;
    `);
    assert.deepEqual(
      db.prepare('SELECT COUNT(*) AS count FROM tellomiPinnedForMe').get(),
      { count: 0 }
    );
  });
});
