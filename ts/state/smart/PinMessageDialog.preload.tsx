// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { getIntl } from '../selectors/user.std.ts';
import { useConversationsActions } from '../ducks/conversations.preload.ts';
import { PinMessageDialog } from '../../components/conversation/pinned-messages/PinMessageDialog.dom.tsx';
import { useItemsActions } from '../ducks/items.preload.ts';
import { getSeenPinMessageDisappearingMessagesWarningCount } from '../selectors/items.dom.ts';
import { getPinMessageDialogData } from '../selectors/globalModals.std.ts';
import { useGlobalModalActions } from '../ducks/globalModals.preload.ts';
import type { TellomiPinChoice } from '../../util/tellomiPinChoice.std.ts';

export type PinMessageDialogData = Readonly<{
  messageId: string;
  hasMaxPinnedMessages: boolean;
  isPinningDisappearingMessage: boolean;
  // Tellomi (ADR-0081 §4.6): who the pin may be for; null = Note to Self, pin without asking.
  tellomiChoices: ReadonlyArray<TellomiPinChoice> | null;
  // Tellomi: the other side of a 1:1 chat, for "Pin for me and ××".
  tellomiContactTitle: string | null;
}>;

export const SmartPinMessageDialog = memo(function SmartPinMessageDialog() {
  const i18n = useSelector(getIntl);
  const pinMessageDialogData = useSelector(getPinMessageDialogData);
  const { hidePinMessageDialog } = useGlobalModalActions();
  const { onPinnedMessageAdd } = useConversationsActions();

  const seenPinMessageDisappearingMessagesWarningCount = useSelector(
    getSeenPinMessageDisappearingMessagesWarningCount
  );
  const { putItem } = useItemsActions();

  const handleClose = useCallback(() => {
    hidePinMessageDialog();
  }, [hidePinMessageDialog]);

  const handleSeenPinMessageDisappearingMessagesWarning = useCallback(() => {
    putItem(
      'seenPinMessageDisappearingMessagesWarningCount',
      seenPinMessageDisappearingMessagesWarningCount + 1
    );
  }, [putItem, seenPinMessageDisappearingMessagesWarningCount]);

  if (pinMessageDialogData == null) {
    return null;
  }

  return (
    <PinMessageDialog
      i18n={i18n}
      open
      onOpenChange={handleClose}
      messageId={pinMessageDialogData.messageId}
      hasMaxPinnedMessages={pinMessageDialogData.hasMaxPinnedMessages}
      isPinningDisappearingMessage={
        pinMessageDialogData.isPinningDisappearingMessage
      }
      tellomiChoices={pinMessageDialogData.tellomiChoices}
      tellomiContactTitle={pinMessageDialogData.tellomiContactTitle}
      seenPinMessageDisappearingMessagesWarningCount={
        seenPinMessageDisappearingMessagesWarningCount
      }
      onSeenPinMessageDisappearingMessagesWarning={
        handleSeenPinMessageDisappearingMessagesWarning
      }
      onPinnedMessageAdd={onPinnedMessageAdd}
    />
  );
});
