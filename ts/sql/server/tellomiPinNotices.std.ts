// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadableDB } from '../Interface.std.ts';
import { sql, sqlJoin } from '../util.std.ts';

/**
 * Tellomi (ADR-0081 §4.4): the ids of this conversation's pin chat events that pin a message sent at one of these
 * times, through the partial index from migration 1805. The caller reads the pinned message again, which also settles
 * its author.
 */
export function getTellomiPinNoticeIdsByTargetSentAt(
  db: ReadableDB,
  conversationId: string,
  targetSentTimestamps: ReadonlyArray<number>
): Array<string> {
  if (targetSentTimestamps.length === 0) {
    return [];
  }
  const [query, params] = sql`
    SELECT id FROM messages
    INDEXED BY messages_tellomi_pin_notice_target
    WHERE
      type IS 'pinned-message-notification' AND
      conversationId IS ${conversationId} AND
      json ->> '$.pinMessage.targetSentTimestamp' IN (${sqlJoin(targetSentTimestamps)})
  `;
  return db.prepare(query, { pluck: true }).all<string>(params);
}
