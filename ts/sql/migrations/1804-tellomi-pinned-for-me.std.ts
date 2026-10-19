// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { WritableDB } from '../Interface.std.ts';
import { sql } from '../util.std.ts';

/**
 * Tellomi (ADR-0081 §4.3, §4.9): the pins that are for me only — synced to my own devices, never sent to the chat —
 * kept beside upstream's pinnedMessages rows, so those keep upstream's shape. Every new pin of a message replaces its
 * row (pinnedMessages.id is AUTOINCREMENT, never reused), and the cascade takes the mark with it: pinning the message
 * for both of us makes it an ordinary pin again. Empty at first (nothing to backfill).
 *
 * Right after 1803, still between upstream's steps of ten (docs/signal/VERSIONS.md).
 */
export default function updateToSchemaVersion1804(db: WritableDB): void {
  const [query] = sql`
    CREATE TABLE tellomiPinnedForMe (
      pinnedMessageId INTEGER PRIMARY KEY NOT NULL
        REFERENCES pinnedMessages(id) ON DELETE CASCADE
    ) STRICT;
  `;
  db.exec(query);
}
