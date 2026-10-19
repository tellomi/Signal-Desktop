// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  DurationSecs,
  SentTimestampMs,
  TimestampMs,
} from '@signalapp/types';
import type { AciString } from '@signalapp/mock-server/src/types.js';
import type { ReadonlyMessageAttributesType } from '../model-types.d.ts';

export type PinnedMessageId = number & { PinnedMessageId: never };

export type PinnedMessage = Readonly<{
  id: PinnedMessageId;
  conversationId: string;
  messageId: string;
  pinnedAt: TimestampMs;
  expiresAt: TimestampMs | null;
  // Tellomi (ADR-0081 §4.3): 1 on a pin for me only (synced to my own devices, never sent to the chat), kept in the
  // tellomiPinnedForMe table; absent on any other pin.
  tellomiForMe?: number;
}>;

export type PinnedMessageParams = Omit<PinnedMessage, 'id' | 'tellomiForMe'> &
  Readonly<{
    // Tellomi (ADR-0081 §4.3): pinned for me only.
    tellomiForMe?: boolean;
  }>;

// Tellomi (ADR-0081 §4.3): whether this pin is for me only.
export function isTellomiPinnedForMe(
  pinnedMessage: Pick<PinnedMessage, 'tellomiForMe'>
): boolean {
  return pinnedMessage.tellomiForMe === 1;
}

// Tellomi (ADR-0081 §4.3): which pins an unpin may take away. Someone else's unpin leaves my pin for me alone; my own
// "for me only" unpin (from another of my devices) takes away only a pin for me; anything else, any pin.
export type TellomiUnpinRule = 'any' | 'keepPinForMe' | 'onlyPinForMe';

export type PinnedMessagePreloadData = Readonly<{
  pinnedMessage: PinnedMessage;
  message: ReadonlyMessageAttributesType;
}>;

export type SendPinMessageType = Readonly<{
  targetAuthorAci: AciString;
  targetSentTimestamp: SentTimestampMs;
  pinDurationSeconds: DurationSecs | null;
  // Tellomi (ADR-0081 §4.1): `DataMessage.tellomi.pinForSelfOnly` (sent only to my own devices) / `pinSilent` (a group
  // pin that doesn't notify).
  tellomiForSelfOnly?: boolean;
  tellomiSilent?: boolean;
}>;

export type SendUnpinMessageType = Readonly<{
  targetAuthorAci: AciString;
  targetSentTimestamp: SentTimestampMs;
  // Tellomi (ADR-0081 §4.1): unpinning a pin for me only (sent only to my own devices).
  tellomiForSelfOnly?: boolean;
}>;
