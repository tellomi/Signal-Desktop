// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { createDB, updateToVersion } from './helpers.node.ts';

// Tellomi (ADR-0068 §4.1, spec R-2, tellomi/tellomi#1263): message_attachments.tellomiLivePhotoVideoJson.
describe('SQL/updateToSchemaVersion1803 (Tellomi)', () => {
  let db: WritableDB;

  beforeEach(() => {
    db = createDB();
  });

  afterEach(() => {
    db.close();
  });

  function columns(): Array<{
    name: string;
    notnull: number;
    dflt_value: unknown;
  }> {
    return db.prepare('PRAGMA table_info(message_attachments)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: unknown;
    }>;
  }

  it('adds a nullable JSON column after 1802', () => {
    updateToVersion(db, 1802);
    const before = columns().map(column => column.name);
    assert.notInclude(before, 'tellomiLivePhotoVideoJson');

    updateToVersion(db, 1803);
    for (const name of ['tellomiLivePhotoVideoJson']) {
      const column = columns().find(found => found.name === name);
      assert.isDefined(column, name);
      assert.strictEqual(column?.notnull, 0);
      assert.isNull(column?.dflt_value);
    }
  });
});
