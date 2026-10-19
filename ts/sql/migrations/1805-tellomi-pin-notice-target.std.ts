// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { WritableDB } from '../Interface.std.ts';
import { sql } from '../util.std.ts';

/**
 * Tellomi (ADR-0081 §4.4): a pin's chat event keeps what the pinned message says ("×× pinned “…”"), and that has to
 * be redone when the pinned message is edited or deleted — deleted for everyone above all, so its words don't stay
 * behind. This index finds those chat events by the pinned message's timestamp without scanning the conversation.
 * It is partial (pin chat events only), so it stays small.
 *
 * Right after 1804, still between upstream's steps of ten (docs/signal/VERSIONS.md).
 */
export default function updateToSchemaVersion1805(db: WritableDB): void {
  const [query] = sql`
    CREATE INDEX messages_tellomi_pin_notice_target ON messages (
      conversationId,
      json ->> '$.pinMessage.targetSentTimestamp'
    ) WHERE type IS 'pinned-message-notification';
  `;
  db.exec(query);
}
