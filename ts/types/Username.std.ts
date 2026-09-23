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
