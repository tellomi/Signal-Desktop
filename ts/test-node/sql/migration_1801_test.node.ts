// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { createDB, updateToVersion } from './helpers.node.ts';

// Tellomi (ADR-0068, tellomi/tellomi#1263): message_attachments.tellomiAsFile.
describe('SQL/updateToSchemaVersion1801 (Tellomi)', () => {
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

  it('adds a nullable tellomiAsFile column after upstream 1800', () => {
    updateToVersion(db, 1800);
    assert.notInclude(
      columns().map(column => column.name),
      'tellomiAsFile'
    );

    updateToVersion(db, 1801);
    const column = columns().find(({ name }) => name === 'tellomiAsFile');
    assert.isDefined(column);
    assert.strictEqual(column?.notnull, 0);
    assert.isNull(column?.dflt_value);
  });
});
