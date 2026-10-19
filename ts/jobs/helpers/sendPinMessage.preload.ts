// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import type { PinMessageJobData } from '../conversationJobQueue.preload.ts';
import { createSendMessageJob } from './createSendMessageJob.preload.ts';

export const sendPinMessage = createSendMessageJob<PinMessageJobData>({
  sendName: 'sendPinMessage',
  sendType: 'pinMessage',
  isSyncOnly(data) {
    // Tellomi (ADR-0081 §4.3): a pin for me only goes to my own devices, never to the chat.
    return data.tellomiForSelfOnly === true;
  },
  getMessageId(data) {
    return data.targetMessageId;
  },
  getMessageOptions(data) {
    return {
      timestamp: data.pinnedAt,
      pinMessage: {
        targetAuthorAci: data.targetAuthorAci,
        targetSentTimestamp: data.targetSentTimestamp,
        pinDurationSeconds: data.pinDurationSeconds,
        tellomiForSelfOnly: data.tellomiForSelfOnly,
        tellomiSilent: data.tellomiSilent,
      },
    };
  },
  getExpirationStartTimestamp(data) {
    return data.pinnedAt;
  },
});
