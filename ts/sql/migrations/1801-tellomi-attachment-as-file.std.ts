// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { WritableDB } from '../Interface.std.ts';

/**
 * Tellomi (ADR-0068, tellomi/tellomi#1263): `AttachmentPointer.tellomi.asFile` — the sender sent this
 * attachment as a file, so it is drawn as a file row whatever its content type. NULL for every
 * attachment that isn't (nothing to backfill).
 *
 * 1801 rather than 1810: upstream numbers its migrations in steps of ten, so its next one still
 * sorts after this. If upstream ever takes 1801, move this one past it (docs/signal/VERSIONS.md).
 */
export default function updateToSchemaVersion1801(db: WritableDB): void {
  db.exec(`
    ALTER TABLE message_attachments
    ADD COLUMN tellomiAsFile INTEGER;
  `);
}
