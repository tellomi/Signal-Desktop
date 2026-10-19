// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0081 §4.6, pinned-messages.md 3.1: before pinning, who it is for; the duration comes after (forever by default).
// The same choices as the phones (Android and iOS `TellomiPinChoice`), from Telegram iOS's pin menu: in a 1:1 chat
// "Pin for me and ××" / "Pin for me", neither preselected; in a group "Pin and notify all members" / "Pin without
// notifying", plus Tellomi's "Pin for me", which is all a member without the pin permission gets. Note to Self pins
// without asking.
export enum TellomiPinChoice {
  // 1:1 chat: pinned for both of us (sent to the other side).
  ForBoth = 'ForBoth',
  // Group: pinned for everyone, and they are notified.
  ForEveryone = 'ForEveryone',
  // Group: pinned for everyone without notifying them (`TellomiDataMessage.pinSilent`).
  ForEveryoneSilent = 'ForEveryoneSilent',
  // Pinned for me only: synced to my own devices (`TellomiDataMessage.pinForSelfOnly`), never sent to the chat.
  ForMe = 'ForMe',
}

// The choices to offer, in order; null means don't ask and pin right away (Note to Self).
export function getTellomiPinChoices({
  isNoteToSelf,
  isGroup,
  canPinForEveryone,
}: Readonly<{
  isNoteToSelf: boolean;
  isGroup: boolean;
  canPinForEveryone: boolean;
}>): ReadonlyArray<TellomiPinChoice> | null {
  if (isNoteToSelf) {
    return null;
  }
  if (!isGroup) {
    return [TellomiPinChoice.ForBoth, TellomiPinChoice.ForMe];
  }
  if (canPinForEveryone) {
    return [
      TellomiPinChoice.ForEveryone,
      TellomiPinChoice.ForEveryoneSilent,
      TellomiPinChoice.ForMe,
    ];
  }
  return [TellomiPinChoice.ForMe];
}

// Whether this pin can be unpinned: a pin for me only always can (it only touches my own devices, even after leaving the
// group); any other pin follows Signal, which needs the group's pin permission ("edit group info") and an active group.
export function canTellomiUnpin({
  isPinnedForMe,
  canPinForEveryone,
  isInactiveGroup,
}: Readonly<{
  isPinnedForMe: boolean;
  canPinForEveryone: boolean;
  isInactiveGroup: boolean;
}>): boolean {
  return isPinnedForMe || (canPinForEveryone && !isInactiveGroup);
}
