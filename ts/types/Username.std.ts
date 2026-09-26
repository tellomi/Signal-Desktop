// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export type UsernameReservationType = Readonly<{
  username: string;
  previousUsername: string | undefined;
  hash: Uint8Array<ArrayBuffer>;
}>;

export enum ReserveUsernameError {
  Unprocessable = 'Unprocessable',
  Conflict = 'Conflict',

  // Maps to UsernameReservationError in state/ducks/usernameEnums.ts
  NotEnoughCharacters = 'NotEnoughCharacters',
  TooManyCharacters = 'TooManyCharacters',
  CheckStartingCharacter = 'CheckStartingCharacter',
  CheckCharacters = 'CheckCharacters',
  NotEnoughDiscriminator = 'NotEnoughDiscriminator',
  AllZeroDiscriminator = 'AllZeroDiscriminator',
  LeadingZeroDiscriminator = 'LeadingZeroDiscriminator',
  TooManyAttempts = 'TooManyAttempts',
  // Tellomi (ADR-0066 §6.2): changed username less than 30 days ago; carries retryAfterSecs.
  ChangeCooldown = 'ChangeCooldown',
}

export enum ConfirmUsernameResult {
  Ok = 'Ok',
  OkRecovered = 'OkRecovered',
  ConflictOrGone = 'ConflictOrGone',
}

export function getNickname(username: string): string | undefined {
  const match = username.match(/^(.*?)(?:\.|$)/);
  if (!match) {
    return undefined;
  }

  return match[1];
}

export function getDiscriminator(username: string): string | undefined {
  const match = username.match(/\.([0-9]*)$/);
  if (!match) {
    return undefined;
  }

  return match[1];
}

// Tellomi (ADR-0066, TR-ID-01): the discriminator is fixed at `01` and hidden. Every username set by a Tellomi client
// is `<nickname>.01`; the server refuses reserved nicknames × `01`–`99`. Any other discriminator (random ones upstream
// clients picked, or a modified client) is shown in full, otherwise `tellomi.57` would pass for `tellomi`.
export const FIXED_DISCRIMINATOR = '01';

// What to show for a username: the bare nickname when it carries the fixed discriminator, the full username otherwise.
export function formatUsernameForDisplay(username: string): string {
  if (getDiscriminator(username) !== FIXED_DISCRIMINATOR) {
    return username;
  }
  return getNickname(username) ?? username;
}

// Tellomi (ADR-0066 §六, TR-ID-01): a new nickname starts with a letter. libsignal only refuses a leading digit and
// accepts a leading `_`; the client tightens that, the same way it tightens the maximum length. Only reservations are
// checked: finding or keeping an existing `_name.01` still works.
export function startsWithLetter(nickname: string): boolean {
  return /^[a-zA-Z]/.test(nickname);
}

// Tellomi (ADR-0066 §6.2): what reserveUsername does with a typed nickname. Pure, so its rules are unit-tested:
// - exactly one candidate, `<nickname>.01` (upstream sends 20 random discriminators);
// - the case-only shortcut (re-confirm the current username with new casing; nothing is reserved and the server,
//   seeing its own hash, starts no cooldown) only when the current discriminator already is 01 — an old `kaixin.37`
//   typing `kaixin` means "move to `kaixin.01`", which is an ordinary reservation;
// - every reservation is a new username and follows the new-username rules (starts with a letter; at most
//   `global.nicknames.max` = 20). That includes moving an old `_kaixin.37` to `_kaixin.01`: the hash changes and the
//   server counts it as a rename, and ADR-0066 §六「老数据」sends that through the ordinary rename flow. Only the
//   case-only shortcut above keeps a name as it is, so an existing `_name.01` or 21–32 character `.01` name can still
//   change its casing. An empty nickname is left to libsignal, which reports it as too short.
export type UsernameReservationPlan =
  | Readonly<{ kind: 'caseChange'; username: string }>
  | Readonly<{
      kind: 'invalid';
      error: ReserveUsernameError.CheckStartingCharacter;
    }>
  | Readonly<{
      kind: 'reserve';
      candidates: ReadonlyArray<
        Readonly<{ nickname: string; discriminator: string }>
      >;
    }>;

export function planUsernameReservation(
  nickname: string,
  previousUsername: string | undefined
): UsernameReservationPlan {
  if (
    previousUsername !== undefined &&
    getDiscriminator(previousUsername) === FIXED_DISCRIMINATOR
  ) {
    const previousNickname = getNickname(previousUsername);
    if (
      previousNickname !== undefined &&
      nickname.toLowerCase() === previousNickname.toLowerCase()
    ) {
      return {
        kind: 'caseChange',
        username: `${nickname}.${FIXED_DISCRIMINATOR}`,
      };
    }
  }

  if (nickname.length > 0 && !startsWithLetter(nickname)) {
    return {
      kind: 'invalid',
      error: ReserveUsernameError.CheckStartingCharacter,
    };
  }

  return {
    kind: 'reserve',
    candidates: [{ nickname, discriminator: FIXED_DISCRIMINATOR }],
  };
}

// A nickname typed without any `.<digits>` (search box, `tell.cc/<nickname>`) means the fixed discriminator.
export function withFixedDiscriminator(input: string): string {
  return getDiscriminator(input) === undefined
    ? `${input}.${FIXED_DISCRIMINATOR}`
    : input;
}

// Tellomi (ADR-0066 §6.2): the server answers a reservation made during the 30-day rename cooldown with
// `429 + Retry-After` (seconds left, rounded up), the same status as ordinary rate limiting. Ordinary limiting is the
// `usernameReserve` leaky bucket (100 per 15 minutes, one permit back every ~9 s), so its Retry-After is seconds; the
// cooldown's is days. Anything above an hour is the cooldown. Android / iOS use the same rule (tellomi/tellomi#1106).
export const RENAME_COOLDOWN_MIN_RETRY_AFTER_SECS = 3600;

// Length of the cooldown a username change starts; the server's AccountsManager.USERNAME_CHANGE_COOLDOWN
// (tellomi/Signal-Server#4). Only used to warn before a change; how long is actually left always comes from the
// server's Retry-After.
export const RENAME_COOLDOWN_DAYS = 30;

// How long the server keeps a cleared or replaced username for its old owner: Accounts.USERNAME_HOLD_DURATION
// (30 days in tellomi/Signal-Server). While such a hold is live, confirming any username — even the same one again —
// counts as a change and starts the cooldown (Accounts.confirmUsernameHash), so "clear, then set" can't dodge it.
export const USERNAME_HOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Whether a username deleted at `deletedAt` (ms; here, or on another device as seen via storage sync) may still be
// held for the account. A deletion time in the future (clock moved back) counts as recent: warning once too often
// beats a silent 30-day lock.
export function isWithinUsernameHold(
  deletedAt: number | undefined,
  now: number
): boolean {
  return (
    deletedAt !== undefined && now - deletedAt < USERNAME_HOLD_DAYS * DAY_MS
  );
}

// Whether a storage sync that sets our username from `previous` to `synced` means the username was deleted on
// another device (the primary uploads an AccountRecord without a username and tells linked devices to sync).
// A first sync after linking (no previous username) is not a deletion.
export function shouldRecordUsernameDeletion(
  previous: string | undefined,
  synced: string | undefined
): boolean {
  return Boolean(previous) && !synced;
}

// Which warning the username editor shows before confirming (ADR-0066 §6.2): none for a first username or a
// case-only change, the change warning when replacing a username, and the set-after-delete warning when there is no
// username now but one was deleted within the hold window. The client can't see the server's holds, so it keeps its
// own deletion time: written when this device deletes the username, and when a storage sync clears it after another
// device deleted it (shouldRecordUsernameDeletion). The sync comes after the deletion, so that time can only be late,
// which warns a little longer than needed, never too short.
export type UsernameSaveConfirmation = 'none' | 'change' | 'setAfterDelete';

export function getUsernameSaveConfirmation({
  currentUsername,
  isCaseChangeOnly,
  deletedAt,
  now,
}: Readonly<{
  currentUsername: string | undefined;
  isCaseChangeOnly: boolean;
  deletedAt: number | undefined;
  now: number;
}>): UsernameSaveConfirmation {
  if (isCaseChangeOnly) {
    return 'none';
  }
  if (currentUsername) {
    return 'change';
  }
  return isWithinUsernameHold(deletedAt, now) ? 'setAfterDelete' : 'none';
}

export function isRenameCooldown(retryAfterSecs: number): boolean {
  return retryAfterSecs > RENAME_COOLDOWN_MIN_RETRY_AFTER_SECS;
}

// Days to show for the cooldown: rounded up and at least 1, never "tomorrow" or hours (same on all three clients,
// tellomi/tellomi#1106). 2,591,999 s right after a change reads "30 days"; two hours left reads "1 day".
export function getRenameCooldownDays(retryAfterSecs: number): number {
  return Math.max(1, Math.ceil(retryAfterSecs / (24 * 60 * 60)));
}

export function isCaseChange({
  previousUsername,
  username,
}: UsernameReservationType): boolean {
  return previousUsername?.toLowerCase() === username.toLowerCase();
}
