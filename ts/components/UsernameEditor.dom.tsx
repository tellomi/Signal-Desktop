// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type JSX,
} from 'react';
import classNames from 'classnames';
import lodash from 'lodash';

import type { LocalizerType } from '../types/Util.std.ts';
import type { UsernameReservationType } from '../types/Username.std.ts';
import { ToastType } from '../types/Toast.dom.tsx';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import {
  RENAME_COOLDOWN_DAYS,
  USERNAME_HOLD_DAYS,
  formatUsernameForDisplay,
  getNickname,
  getRenameCooldownDays,
  getUsernameSaveConfirmation,
  isCaseChange,
} from '../types/Username.std.ts';
import type { UsernameSaveConfirmation } from '../types/Username.std.ts';
import {
  UsernameReservationState,
  UsernameReservationError,
} from '../state/ducks/usernameEnums.std.ts';
import type { ReserveUsernameOptionsType } from '../state/ducks/username.preload.ts';
import type { ShowToastAction } from '../state/ducks/toast.preload.ts';
import { Input } from './Input.dom.tsx';
import { Spinner } from './Spinner.dom.tsx';
import { useConfirmDiscard } from '../hooks/useConfirmDiscard.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { AxoConfirmDialog } from '../axo/AxoConfirmDialog.dom.tsx';

const { noop } = lodash;

export type PropsDataType = Readonly<{
  i18n: LocalizerType;
  currentUsername?: string;
  usernameCorrupted: boolean;
  reservation?: UsernameReservationType;
  error?: UsernameReservationError;
  state: UsernameReservationState;
  recoveredUsername: string | undefined;
  minNickname: number;
  maxNickname: number;
  // Tellomi (ADR-0066 §6.2): seconds left in the rename cooldown, with error ChangeCooldown.
  cooldownRetryAfterSecs?: number;
  // Tellomi (ADR-0066 §6.2): when the account's username was last deleted, here or on another device (seen via storage
  // sync), if it was.
  usernameDeletedAt?: number;
}>;

export type ActionPropsDataType = Readonly<{
  setUsernameReservationError: (
    error: UsernameReservationError | undefined
  ) => void;
  clearUsernameReservation: () => void;
  reserveUsername: (optiona: ReserveUsernameOptionsType) => void;
  confirmUsername: () => void;
  showToast: ShowToastAction;
}>;

export type ExternalPropsDataType = Readonly<{
  onClose: () => void;
}>;

export type PropsType = PropsDataType &
  ActionPropsDataType &
  ExternalPropsDataType;

// Tellomi (ADR-0066): no discriminator field. The discriminator is fixed at `01` (see reserveUsername) and never
// shown; the user only ever edits the nickname.
enum UpdateState {
  Original = 'Original',
  Nickname = 'Nickname',
}

export function UsernameEditor({
  i18n,
  currentUsername,
  usernameCorrupted,
  reserveUsername,
  confirmUsername,
  showToast,
  minNickname,
  maxNickname,
  reservation,
  setUsernameReservationError,
  clearUsernameReservation,
  error,
  state,
  recoveredUsername,
  cooldownRetryAfterSecs,
  usernameDeletedAt,
  onClose,
}: PropsType): JSX.Element {
  const currentNickname = useMemo(() => {
    if (!currentUsername) {
      return undefined;
    }

    return getNickname(currentUsername);
  }, [currentUsername]);

  const [updateState, setUpdateState] = useState(UpdateState.Original);
  const [nickname, setNickname] = useState(currentNickname);
  // Which warning and whether it is showing are kept apart: closing only flips the second, so the dialog keeps its
  // text through the exit animation instead of flashing the other warning.
  const [saveConfirmation, setSaveConfirmation] =
    useState<UsernameSaveConfirmation>('none');
  const [isSaveConfirmationOpen, setIsSaveConfirmationOpen] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  // Clear reservation if user erases the nickname
  useEffect(() => {
    if (updateState === UpdateState.Nickname && !nickname) {
      clearUsernameReservation();
    }
  }, [clearUsernameReservation, nickname, updateState]);

  const isReserving = state === UsernameReservationState.Reserving;
  const isConfirming = state === UsernameReservationState.Confirming;
  const canSave = !isReserving && !isConfirming && reservation !== undefined;

  useEffect(() => {
    if (state === UsernameReservationState.Closed) {
      setTimeout(() => onClose(), 500);
    }
  }, [state, onClose]);

  useEffect(() => {
    if (state === UsernameReservationState.Closed && recoveredUsername) {
      showToast({
        toastType: ToastType.UsernameRecovered,
        parameters: {
          username: recoveredUsername,
        },
      });
    }
  }, [state, recoveredUsername, showToast]);

  const errorString = useMemo(() => {
    if (!error) {
      return undefined;
    }
    if (error === UsernameReservationError.NotEnoughCharacters) {
      return i18n('icu:ProfileEditor--username--check-character-min-plural', {
        min: minNickname,
      });
    }
    if (error === UsernameReservationError.TooManyCharacters) {
      return i18n('icu:ProfileEditor--username--check-character-max-plural', {
        max: maxNickname,
      });
    }
    if (error === UsernameReservationError.CheckStartingCharacter) {
      // Tellomi (ADR-0066 §六): a leading `_` is refused as well as a leading digit, so upstream's "cannot begin with
      // a number" would be wrong for it.
      return i18n(
        'icu:ProfileEditor--username--check-starting-character--tellomi'
      );
    }
    if (error === UsernameReservationError.CheckCharacters) {
      return i18n('icu:ProfileEditor--username--check-characters');
    }
    if (error === UsernameReservationError.UsernameNotAvailable) {
      return i18n('icu:ProfileEditor--username--unavailable');
    }
    if (error === UsernameReservationError.NotEnoughDiscriminator) {
      return i18n('icu:ProfileEditor--username--check-discriminator-min');
    }
    if (error === UsernameReservationError.AllZeroDiscriminator) {
      return i18n('icu:ProfileEditor--username--check-discriminator-all-zero');
    }
    if (error === UsernameReservationError.LeadingZeroDiscriminator) {
      return i18n(
        'icu:ProfileEditor--username--check-discriminator-leading-zero'
      );
    }
    if (error === UsernameReservationError.TooManyAttempts) {
      return i18n('icu:ProfileEditor--username--too-many-attempts');
    }
    if (error === UsernameReservationError.ChangeCooldown) {
      return i18n('icu:ProfileEditor--username--change-cooldown', {
        days: getRenameCooldownDays(cooldownRetryAfterSecs ?? 0),
      });
    }
    // Displayed through confirmation modal below
    if (
      error === UsernameReservationError.General ||
      error === UsernameReservationError.ConflictOrGone
    ) {
      return;
    }
    throw missingCaseError(error);
  }, [error, i18n, minNickname, maxNickname, cooldownRetryAfterSecs]);

  useEffect(() => {
    // Initial effect run
    if (updateState === UpdateState.Original) {
      return;
    }

    // Sanity-check, we should never get here.
    if (!nickname) {
      return;
    }

    if (isConfirming) {
      return;
    }

    reserveUsername({ nickname });
  }, [updateState, nickname, reserveUsername, isConfirming]);

  const onChange = useCallback((newNickname: string) => {
    setUpdateState(UpdateState.Nickname);
    setNickname(newNickname);
  }, []);

  const onSave = useCallback(() => {
    if (usernameCorrupted) {
      setIsConfirmingReset(true);
      return;
    }
    // Tellomi (ADR-0066 §6.2): warn before anything that starts the 30-day rename cooldown — replacing a username,
    // or setting one while a recently deleted username (deleted here or on another device) may still be held
    // (clear + set counts as a change).
    const confirmation = getUsernameSaveConfirmation({
      currentUsername,
      isCaseChangeOnly: Boolean(reservation && isCaseChange(reservation)),
      deletedAt: usernameDeletedAt,
      now: Date.now(),
    });
    if (confirmation === 'none') {
      confirmUsername();
    } else {
      setSaveConfirmation(confirmation);
      setIsSaveConfirmationOpen(true);
    }
  }, [
    confirmUsername,
    currentUsername,
    reservation,
    usernameCorrupted,
    usernameDeletedAt,
  ]);

  const onCancelSave = useCallback(() => {
    setIsConfirmingReset(false);
    setIsSaveConfirmationOpen(false);
  }, []);

  const onConfirmUsername = useCallback(() => {
    confirmUsername();
  }, [confirmUsername]);

  const onCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const tryClose = useRef<(() => void) | null>(null);
  const [confirmDiscardModal, confirmDiscardIf] = useConfirmDiscard({
    i18n,
    name: 'UsernameEditor',
    tryClose,
    // @ts-expect-error ConfirmationDialog migration: Needs title
    title: null,
    // @ts-expect-error ConfirmationDialog migration: Needs description
    description: null,
  });

  const onTryClose = useCallback(() => {
    const onDiscard = noop;
    confirmDiscardIf(currentNickname !== nickname, onDiscard);
  }, [confirmDiscardIf, currentNickname, nickname]);
  // oxlint-disable-next-line react/refs
  tryClose.current = onTryClose;

  // Preview of what others will see: the reserved username, or the current one while the nickname is unchanged,
  // both in display form (`kaixin.01` → `kaixin`; an old `kaixin.57` stays `kaixin.57`).
  let title = i18n('icu:ProfileEditor--username--title');
  if (reservation) {
    title = formatUsernameForDisplay(reservation.username);
  } else if (currentUsername && nickname === currentNickname) {
    title = formatUsernameForDisplay(currentUsername);
  }

  return (
    <>
      <div className="UsernameEditor__header">
        <div className="UsernameEditor__header__large-at" />

        <div className="UsernameEditor__header__preview">{title}</div>
      </div>
      <Input
        moduleClassName="UsernameEditor__input"
        i18n={i18n}
        disableSpellcheck
        disabled={isConfirming}
        onChange={onChange}
        onEnter={onSave}
        placeholder={i18n('icu:EditUsernameModalBody__username-placeholder')}
        value={nickname}
      >
        {isReserving && <Spinner size="16px" svgSize="small" />}
      </Input>
      {errorString && (
        <div className="UsernameEditor__error">{errorString}</div>
      )}
      <div
        className={classNames(
          'UsernameEditor__info',
          !errorString ? 'UsernameEditor__info--no-error' : undefined
        )}
      >
        {/* Tellomi (ADR-0066): upstream says "Usernames are always paired with a set of numbers" with a "Learn more"
            about the digits. There are no digits any more; like Telegram's UsernameHelp under the field, say what a
            username is for and what it may contain. */}
        {i18n('icu:EditUsernameModalBody__username-helper--tellomi', {
          min: minNickname,
          max: maxNickname,
        })}
      </div>
      <div className="UsernameEditor__button-footer">
        <AxoButton.Root
          variant="strong-secondary"
          size="lg"
          disabled={isConfirming}
          onClick={onCancel}
        >
          {i18n('icu:cancel')}
        </AxoButton.Root>
        <AxoButton.Root
          variant="strong-primary"
          size="lg"
          disabled={!canSave}
          onClick={onSave}
          pending={isConfirming}
        >
          {i18n('icu:save')}
        </AxoButton.Root>
      </div>

      {confirmDiscardModal}

      <AxoConfirmDialog.Root
        open={error === UsernameReservationError.General}
        onOpenChange={() => setUsernameReservationError(undefined)}
        // @ts-expect-error ConfirmationDialog migration: Needs title
        title={null}
        description={i18n('icu:ProfileEditor--username--general-error')}
      >
        <AxoConfirmDialog.Cancel>{i18n('icu:ok')}</AxoConfirmDialog.Cancel>
      </AxoConfirmDialog.Root>

      <AxoConfirmDialog.Root
        open={error === UsernameReservationError.ConflictOrGone}
        onOpenChange={() => {
          if (nickname) {
            reserveUsername({ nickname });
          }
        }}
        // @ts-expect-error ConfirmationDialog migration: Needs title
        title={null}
        // Tellomi (ADR-0066): upstream promises "a new set of digits" here; with the fixed `01` saving again just
        // reserves the same username.
        description={i18n(
          'icu:ProfileEditor--username--reservation-gone--tellomi',
          {
            username: reservation
              ? formatUsernameForDisplay(reservation.username)
              : (nickname ?? ''),
          }
        )}
      >
        <AxoConfirmDialog.Cancel>{i18n('icu:ok')}</AxoConfirmDialog.Cancel>
      </AxoConfirmDialog.Root>

      <AxoConfirmDialog.Root
        open={isSaveConfirmationOpen}
        onOpenChange={onCancelSave}
        // @ts-expect-error ConfirmationDialog migration: Needs title
        title={null}
        // Tellomi (ADR-0066 §6.2): everything confirmed here starts the rename cooldown (a first username never
        // gets here), so the user hears about the 30 days before, not after.
        description={
          saveConfirmation === 'setAfterDelete'
            ? i18n(
                'icu:EditUsernameModalBody__set-after-delete-confirmation--tellomi',
                { holdDays: USERNAME_HOLD_DAYS, days: RENAME_COOLDOWN_DAYS }
              )
            : i18n('icu:EditUsernameModalBody__change-confirmation--tellomi', {
                days: RENAME_COOLDOWN_DAYS,
              })
        }
      >
        <AxoConfirmDialog.Cancel />
        <AxoConfirmDialog.Action
          variant="strong-destructive"
          onClick={onConfirmUsername}
        >
          {i18n('icu:EditUsernameModalBody__change-confirmation__continue')}
        </AxoConfirmDialog.Action>
      </AxoConfirmDialog.Root>

      <AxoConfirmDialog.Root
        open={isConfirmingReset}
        onOpenChange={onCancelSave}
        // @ts-expect-error ConfirmationDialog migration: Needs title
        title={null}
        // Tellomi (ADR-0066 §6.2): recovering confirms a username, which the server counts as a change, so it starts
        // (or restarts) the rename cooldown too — say so here as well, not only on a plain change.
        description={i18n(
          'icu:EditUsernameModalBody__recover-confirmation--tellomi',
          { days: RENAME_COOLDOWN_DAYS }
        )}
      >
        <AxoConfirmDialog.Cancel />
        <AxoConfirmDialog.Action
          variant="strong-destructive"
          onClick={onConfirmUsername}
        >
          {i18n('icu:EditUsernameModalBody__change-confirmation__continue')}
        </AxoConfirmDialog.Action>
      </AxoConfirmDialog.Root>
    </>
  );
}
