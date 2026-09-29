// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { itemStorage } from '../textsecure/Storage.preload.ts';

export function getLinkPreviewSetting(): boolean {
  return itemStorage.get('linkPreviews', false);
}

// Tellomi (ADR-0063 §8.1 row 9): on unless turned off on this device; never synced.
export function getExpandShortLinksSetting(): boolean {
  return itemStorage.get('tellomiExpandShortLinks', true);
}

export function getTypingIndicatorSetting(): boolean {
  return itemStorage.get('typingIndicators', false);
}
export function getReadReceiptSetting(): boolean {
  return itemStorage.get('read-receipt-setting', false);
}
export function getSealedSenderIndicatorSetting(): boolean {
  return itemStorage.get('sealedSenderIndicators', false);
}

export function areStoryViewReceiptsEnabled(): boolean {
  return (
    itemStorage.get('storyViewReceiptsEnabled') ??
    itemStorage.get('read-receipt-setting') ??
    false
  );
}
