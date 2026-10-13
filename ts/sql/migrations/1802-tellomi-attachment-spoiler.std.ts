// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { WritableDB } from '../Interface.std.ts';

/**
 * Tellomi (ADR-0068 §4.1, spec R-1, tellomi/tellomi#1263): `AttachmentPointer.tellomi.spoiler` — the
 * sender covered this image / video — and whether this device has uncovered it (D10: local only, never
 * sent, never backed up). NULL for every attachment that isn't covered (nothing to backfill).
 *
 * Right after 1801, still between upstream's steps of ten (docs/signal/VERSIONS.md).
 */
export default function updateToSchemaVersion1802(db: WritableDB): void {
  db.exec(`
    ALTER TABLE message_attachments
    ADD COLUMN tellomiSpoiler INTEGER;

    ALTER TABLE message_attachments
    ADD COLUMN tellomiSpoilerRevealed INTEGER;
  `);
}
