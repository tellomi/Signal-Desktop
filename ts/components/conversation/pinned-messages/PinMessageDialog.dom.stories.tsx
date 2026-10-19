// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type JSX } from 'react';
import type { Meta } from '@storybook/react';
import { action } from '@storybook/addon-actions';
import { PinMessageDialog } from './PinMessageDialog.dom.tsx';
import { TellomiPinChoice } from '../../../util/tellomiPinChoice.std.ts';

const { i18n } = window.SignalContext;

export default {
  title: 'Components/PinnedMessages/PinMessageDialog',
} satisfies Meta;

export function Default(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <PinMessageDialog
      i18n={i18n}
      open={open}
      onOpenChange={setOpen}
      messageId="42"
      onPinnedMessageAdd={action('onPinnedMessageAdd')}
      hasMaxPinnedMessages
      isPinningDisappearingMessage
      seenPinMessageDisappearingMessagesWarningCount={0}
      onSeenPinMessageDisappearingMessagesWarning={action(
        'onSeenPinMessageDisappearingMessagesWarning'
      )}
      tellomiChoices={[TellomiPinChoice.ForBoth, TellomiPinChoice.ForMe]}
      tellomiContactTitle="Alice"
    />
  );
}

// Tellomi (ADR-0081 §4.6, pinned-messages.md 3.1): who the pin is for.
function TellomiChoices({
  choices,
  contactTitle,
}: {
  choices: ReadonlyArray<TellomiPinChoice>;
  contactTitle: string | null;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <PinMessageDialog
      i18n={i18n}
      open={open}
      onOpenChange={setOpen}
      messageId="42"
      onPinnedMessageAdd={action('onPinnedMessageAdd')}
      hasMaxPinnedMessages={false}
      isPinningDisappearingMessage={false}
      seenPinMessageDisappearingMessagesWarningCount={0}
      onSeenPinMessageDisappearingMessagesWarning={action(
        'onSeenPinMessageDisappearingMessagesWarning'
      )}
      tellomiChoices={choices}
      tellomiContactTitle={contactTitle}
    />
  );
}

export function TellomiDirectChat(): JSX.Element {
  return (
    <TellomiChoices
      choices={[TellomiPinChoice.ForBoth, TellomiPinChoice.ForMe]}
      contactTitle="Alice"
    />
  );
}

export function TellomiGroupWithPermission(): JSX.Element {
  return (
    <TellomiChoices
      choices={[
        TellomiPinChoice.ForEveryone,
        TellomiPinChoice.ForEveryoneSilent,
        TellomiPinChoice.ForMe,
      ]}
      contactTitle={null}
    />
  );
}

export function TellomiGroupWithoutPermission(): JSX.Element {
  return (
    <TellomiChoices choices={[TellomiPinChoice.ForMe]} contactTitle={null} />
  );
}
