// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { UnpinMessageJobData } from '../conversationJobQueue.preload.ts';
import { createSendMessageJob } from './createSendMessageJob.preload.ts';

export const sendUnpinMessage = createSendMessageJob<UnpinMessageJobData>({
  sendName: 'sendUnpinMessage',
  sendType: 'unpinMessage',
  isSyncOnly(data) {
    return data.isSyncOnly;
  },
  getMessageId(data) {
    return data.targetMessageId;
  },
  getMessageOptions(data) {
    return {
      timestamp: data.unpinnedAt,
      unpinMessage: {
        targetAuthorAci: data.targetAuthorAci,
        targetSentTimestamp: data.targetSentTimestamp,
        // Tellomi (ADR-0081 §4.3): unpinning a pin for me only (with isSyncOnly).
        tellomiForSelfOnly: data.tellomiForSelfOnly,
      },
    };
  },
  getExpirationStartTimestamp(data) {
    return data.unpinnedAt;
  },
});
