// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { AxoDialog } from '../../../axo/AxoDialog.dom.tsx';
import { AxoButton } from '../../../axo/AxoButton.dom.tsx';
import { AxoSelect } from '../../../axo/AxoSelect.dom.tsx';
import { tw } from '../../../axo/tw.dom.tsx';
import { TellomiPinChoice } from '../../../util/tellomiPinChoice.std.ts';
import type { LocalizerType } from '../../../types/I18N.std.ts';
import { strictAssert } from '../../../util/assert.std.ts';
import { AxoAlertDialog } from '../../../axo/AxoAlertDialog.dom.tsx';
import { isInternalFeaturesEnabled } from '../../../util/isInternalFeaturesEnabled.dom.ts';
import { DurationSecs } from '@signalapp/types';
import { missingCaseError } from '../../../util/missingCaseError.std.ts';

enum DurationOption {
  TIME_24_HOURS = 'TIME_24_HOURS',
  TIME_7_DAYS = 'TIME_7_DAYS',
  TIME_30_DAYS = 'TIME_30_DAYS',
  FOREVER = 'FOREVER',
  DEBUG_10_SECONDS = 'DEBUG_10_SECONDS',
}

const DURATION_OPTIONS: Record<DurationOption, DurationSecs | null> = {
  [DurationOption.TIME_24_HOURS]: DurationSecs.fromHours(24),
  [DurationOption.TIME_7_DAYS]: DurationSecs.fromDays(7),
  [DurationOption.TIME_30_DAYS]: DurationSecs.fromDays(30),
  [DurationOption.FOREVER]: null,
  [DurationOption.DEBUG_10_SECONDS]: DurationSecs.fromSeconds(10),
};

enum Step {
  CLOSED,
  CONFIRM_REPLACE_OLDEST_PIN,
  SELECT_PIN_DURATION,
  DISAPPEARING_MESSAGES_WARNING,
}

function isValidDurationOption(value: string): value is DurationOption {
  return Object.hasOwn(DURATION_OPTIONS, value);
}

export type PinMessageDialogProps = Readonly<{
  i18n: LocalizerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  hasMaxPinnedMessages: boolean;
  isPinningDisappearingMessage: boolean;
  seenPinMessageDisappearingMessagesWarningCount: number;
  onSeenPinMessageDisappearingMessagesWarning: () => void;
  // Tellomi (ADR-0081 §4.6): who the pin may be for, in order; null = pin forever without asking (Note to Self).
  tellomiChoices: ReadonlyArray<TellomiPinChoice> | null;
  // Tellomi: the other side of a 1:1 chat, for "Pin for me and ××".
  tellomiContactTitle: string | null;
  onPinnedMessageAdd: (
    messageId: string,
    duration: DurationSecs | null,
    tellomiChoice?: TellomiPinChoice
  ) => void;
}>;

export const PinMessageDialog = memo(function PinMessageDialog(
  props: PinMessageDialogProps
) {
  const {
    i18n,
    onOpenChange,
    messageId,
    hasMaxPinnedMessages,
    isPinningDisappearingMessage,
    onPinnedMessageAdd,
    seenPinMessageDisappearingMessagesWarningCount,
    onSeenPinMessageDisappearingMessagesWarning,
    tellomiChoices,
    tellomiContactTitle,
  } = props;

  const needsConfirmReplaceOldestPin = useMemo(() => {
    return hasMaxPinnedMessages;
  }, [hasMaxPinnedMessages]);
  const needsConfirmDisappearingMessages = useMemo(() => {
    return (
      isPinningDisappearingMessage &&
      seenPinMessageDisappearingMessagesWarningCount <= 3
    );
  }, [
    isPinningDisappearingMessage,
    seenPinMessageDisappearingMessagesWarningCount,
  ]);

  const [duration, setDuration] = useState<DurationOption | null>(null);
  const [tellomiChoice, setTellomiChoice] = useState<
    TellomiPinChoice | undefined
  >(undefined);
  const [confirmedReplaceOldestPin, setConfirmedReplaceOldestPin] =
    useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      // reset state
      setDuration(null);
      setTellomiChoice(undefined);
      setConfirmedReplaceOldestPin(false);
    },
    [onOpenChange]
  );

  const submit = useCallback(
    (
      selectedDuration: DurationOption,
      choice: TellomiPinChoice | undefined
    ) => {
      const durationValue = DURATION_OPTIONS[selectedDuration];
      onPinnedMessageAdd(messageId, durationValue, choice);
      handleOpenChange(false);
    },
    [onPinnedMessageAdd, messageId, handleOpenChange]
  );

  // Tellomi (ADR-0081 §4.6): Note to Self pins forever without asking who for; it still confirms replacing the oldest
  // pin or pinning a disappearing message. (With nothing to confirm, the menu pins without opening this dialog.)
  const pinsWithoutAsking = tellomiChoices == null;
  const effectiveDuration =
    duration ?? (pinsWithoutAsking ? DurationOption.FOREVER : null);

  const handleConfirmReplaceOldestPin = useCallback(() => {
    setConfirmedReplaceOldestPin(true);
    if (pinsWithoutAsking && !needsConfirmDisappearingMessages) {
      submit(DurationOption.FOREVER, undefined);
    }
  }, [pinsWithoutAsking, needsConfirmDisappearingMessages, submit]);

  // Tellomi (ADR-0081 §4.6): who it is for and for how long, chosen together.
  const handleTellomiSelect = useCallback(
    (
      selectedDuration: DurationOption,
      choice: TellomiPinChoice | undefined
    ) => {
      setDuration(selectedDuration);
      setTellomiChoice(choice);
      if (!needsConfirmDisappearingMessages) {
        submit(selectedDuration, choice);
      }
    },
    [needsConfirmDisappearingMessages, submit]
  );

  const handleConfirmDisappearingMessages = useCallback(() => {
    strictAssert(effectiveDuration != null, 'Duration should not be null');
    onSeenPinMessageDisappearingMessagesWarning();
    submit(effectiveDuration, tellomiChoice);
  }, [
    onSeenPinMessageDisappearingMessagesWarning,
    effectiveDuration,
    tellomiChoice,
    submit,
  ]);

  let step: Step;
  if (!props.open) {
    step = Step.CLOSED;
  } else if (needsConfirmReplaceOldestPin && !confirmedReplaceOldestPin) {
    step = Step.CONFIRM_REPLACE_OLDEST_PIN;
  } else if (effectiveDuration == null) {
    step = Step.SELECT_PIN_DURATION;
  } else if (needsConfirmDisappearingMessages) {
    step = Step.DISAPPEARING_MESSAGES_WARNING;
  } else {
    step = Step.CLOSED;
  }

  return (
    <>
      <PinMessageConfirmReplacePinDialog
        i18n={i18n}
        open={step === Step.CONFIRM_REPLACE_OLDEST_PIN}
        onOpenChange={handleOpenChange}
        onConfirmReplaceOldestPin={handleConfirmReplaceOldestPin}
      />
      <TellomiPinChoiceDialog
        i18n={i18n}
        open={step === Step.SELECT_PIN_DURATION}
        onOpenChange={handleOpenChange}
        choices={tellomiChoices ?? []}
        contactTitle={tellomiContactTitle}
        onSelect={handleTellomiSelect}
      />
      <PinMessageDisappearingMessagesWarningDialog
        i18n={i18n}
        open={step === Step.DISAPPEARING_MESSAGES_WARNING}
        onOpenChange={handleOpenChange}
        onConfirm={handleConfirmDisappearingMessages}
      />
    </>
  );
});

function PinMessageConfirmReplacePinDialog(props: {
  i18n: LocalizerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmReplaceOldestPin: () => void;
}) {
  const { i18n, onConfirmReplaceOldestPin } = props;
  const handleConfirmReplaceOldestPin = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      onConfirmReplaceOldestPin();
    },
    [onConfirmReplaceOldestPin]
  );
  return (
    <AxoAlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AxoAlertDialog.Content escape="cancel-is-noop">
        <AxoAlertDialog.Body>
          <AxoAlertDialog.Title>
            {i18n('icu:PinMessageDialog--HasMaxPinnedMessages__Title')}
          </AxoAlertDialog.Title>
          <AxoAlertDialog.Description>
            {i18n('icu:PinMessageDialog--HasMaxPinnedMessages__Description')}
          </AxoAlertDialog.Description>
        </AxoAlertDialog.Body>
        <AxoAlertDialog.Footer>
          <AxoAlertDialog.Cancel />
          <AxoAlertDialog.Action
            variant="strong-primary"
            onClick={handleConfirmReplaceOldestPin}
          >
            {i18n('icu:PinMessageDialog--HasMaxPinnedMessages__Continue')}
          </AxoAlertDialog.Action>
        </AxoAlertDialog.Footer>
      </AxoAlertDialog.Content>
    </AxoAlertDialog.Root>
  );
}

// Tellomi (ADR-0081 §4.6, pinned-messages.md 3.1): who the pin is for, as on the phones (neither preselected), with the
// duration underneath, forever by default (Signal's 24 hours / 7 days / 30 days stay). Choosing one pins.
function TellomiPinChoiceDialog(props: {
  i18n: LocalizerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: ReadonlyArray<TellomiPinChoice>;
  contactTitle: string | null;
  onSelect: (duration: DurationOption, choice: TellomiPinChoice) => void;
}) {
  const { i18n, onOpenChange, onSelect, choices, contactTitle } = props;
  const [duration, setDuration] = useState(DurationOption.FOREVER);

  const handleDurationChange = useCallback((value: string) => {
    strictAssert(isValidDurationOption(value), `Invalid option: ${value}`);
    setDuration(value);
  }, []);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <AxoDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AxoDialog.Content
        size="sm"
        escape="cancel-is-noop"
        disableMissingAriaDescriptionWarning
      >
        <AxoDialog.Header>
          <AxoDialog.Title>
            {i18n('icu:TellomiPinMessageDialog__Title')}
          </AxoDialog.Title>
          <AxoDialog.Close />
        </AxoDialog.Header>
        <AxoDialog.Body>
          <div className={tw('flex flex-col gap-2')}>
            {choices.map(choice => (
              <AxoButton.Root
                key={choice}
                variant="subtle-secondary"
                size="lg"
                width="full"
                onClick={() => onSelect(duration, choice)}
              >
                {getTellomiPinChoiceLabel(i18n, choice, contactTitle)}
              </AxoButton.Root>
            ))}
          </div>
          <div className={tw('mt-4 flex items-center gap-3')}>
            <span className={tw('shrink-0 type-body-medium text-secondary')}>
              {i18n('icu:TellomiPinMessageDialog__Duration')}
            </span>
            <AxoSelect.Root
              value={duration}
              onValueChange={handleDurationChange}
            >
              <AxoSelect.Trigger width="full" placeholder="" />
              <AxoSelect.Content>
                <AxoSelect.Item value={DurationOption.TIME_24_HOURS}>
                  <AxoSelect.ItemText>
                    {i18n('icu:PinMessageDialog__Option--TIME_24_HOURS')}
                  </AxoSelect.ItemText>
                </AxoSelect.Item>
                <AxoSelect.Item value={DurationOption.TIME_7_DAYS}>
                  <AxoSelect.ItemText>
                    {i18n('icu:PinMessageDialog__Option--TIME_7_DAYS')}
                  </AxoSelect.ItemText>
                </AxoSelect.Item>
                <AxoSelect.Item value={DurationOption.TIME_30_DAYS}>
                  <AxoSelect.ItemText>
                    {i18n('icu:PinMessageDialog__Option--TIME_30_DAYS')}
                  </AxoSelect.ItemText>
                </AxoSelect.Item>
                <AxoSelect.Item value={DurationOption.FOREVER}>
                  <AxoSelect.ItemText>
                    {i18n('icu:PinMessageDialog__Option--FOREVER')}
                  </AxoSelect.ItemText>
                </AxoSelect.Item>
                {isInternalFeaturesEnabled() && (
                  <AxoSelect.Item value={DurationOption.DEBUG_10_SECONDS}>
                    <AxoSelect.ItemText>
                      10 seconds (Internal)
                    </AxoSelect.ItemText>
                  </AxoSelect.Item>
                )}
              </AxoSelect.Content>
            </AxoSelect.Root>
          </div>
        </AxoDialog.Body>
        <AxoDialog.Footer>
          <AxoDialog.Actions>
            <AxoDialog.Action variant="strong-secondary" onClick={handleCancel}>
              {i18n('icu:PinMessageDialog__Cancel')}
            </AxoDialog.Action>
          </AxoDialog.Actions>
        </AxoDialog.Footer>
      </AxoDialog.Content>
    </AxoDialog.Root>
  );
}

function getTellomiPinChoiceLabel(
  i18n: LocalizerType,
  choice: TellomiPinChoice,
  contactTitle: string | null
): string {
  switch (choice) {
    case TellomiPinChoice.ForBoth:
      return i18n('icu:TellomiPinMessageDialog__ForMeAnd', {
        name: contactTitle ?? '',
      });
    case TellomiPinChoice.ForEveryone:
      return i18n('icu:TellomiPinMessageDialog__NotifyAll');
    case TellomiPinChoice.ForEveryoneSilent:
      return i18n('icu:TellomiPinMessageDialog__WithoutNotifying');
    case TellomiPinChoice.ForMe:
      return i18n('icu:TellomiPinMessageDialog__ForMe');
    default:
      throw missingCaseError(choice);
  }
}

function PinMessageDisappearingMessagesWarningDialog(props: {
  i18n: LocalizerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { i18n } = props;
  return (
    <AxoAlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AxoAlertDialog.Content escape="cancel-is-destructive">
        <AxoAlertDialog.Body>
          <AxoAlertDialog.Title>
            {i18n('icu:PinMessageDisappearingMessagesWarningDialog__Title')}
          </AxoAlertDialog.Title>
          <AxoAlertDialog.Description>
            {i18n(
              'icu:PinMessageDisappearingMessagesWarningDialog__Description'
            )}
          </AxoAlertDialog.Description>
        </AxoAlertDialog.Body>
        <AxoAlertDialog.Footer>
          <AxoAlertDialog.Action
            variant="strong-primary"
            onClick={props.onConfirm}
          >
            {i18n('icu:PinMessageDisappearingMessagesWarningDialog__Okay')}
          </AxoAlertDialog.Action>
        </AxoAlertDialog.Footer>
      </AxoAlertDialog.Content>
    </AxoAlertDialog.Root>
  );
}
