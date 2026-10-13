// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { WritableDB } from '../Interface.std.ts';

/**
 * Tellomi (ADR-0068 §4.1, spec R-2, tellomi/tellomi#1263): `AttachmentPointer.tellomi.livePhotoVideo` —
 * the moving half of a live photo, kept on the still as JSON (the video isn't an attachment of its own).
 * NULL for every attachment that isn't a live photo (nothing to backfill).
 *
 * Right after 1802, still between upstream's steps of ten (docs/signal/VERSIONS.md).
 */
export default function updateToSchemaVersion1803(db: WritableDB): void {
  db.exec(`
    ALTER TABLE message_attachments
    ADD COLUMN tellomiLivePhotoVideoJson TEXT;
  `);
}
