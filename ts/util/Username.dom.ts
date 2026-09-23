// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as RemoteConfig from '../RemoteConfig.dom.ts';
import {
  getDiscriminator,
  getNickname,
  withFixedDiscriminator,
} from '../types/Username.std.ts';
import { parseIntWithFallback } from './parseIntWithFallback.std.ts';

export function getMaxNickname(): number {
  return parseIntWithFallback(
    RemoteConfig.getValue('global.nicknames.max'),
    32
  );
}
export function getMinNickname(): number {
  return parseIntWithFallback(RemoteConfig.getValue('global.nicknames.min'), 3);
}

// Usernames have a minimum length of 3 and maximum of 32
const USERNAME_LIKE = /^@?[a-zA-Z_][a-zA-Z0-9_]{2,31}(.\d*?)?$/;
const NICKNAME_CHARS = /^[a-zA-Z_][a-zA-Z0-9_]+$/;
const ALL_DIGITS = /^\d+$/;

// Tellomi (TR-ID-01, tellomi/tellomi#1181): the server sends `global.nicknames.max` = 20, which limits *new*
// usernames only (getMaxNickname() above, used by the editor and by reserveUsername). Whether an existing username is
// well-formed is the protocol's question: libsignal allows nicknames up to 32. Upstream both values are 32, so
// isUsernameValid() could use the remote one; with 20 it would make ConversationModel.updateUsername drop every
// existing 21–32 character username ("username is invalid, dropping"). Android does the same split
// (UsernameUtil.MAX_NICKNAME_LENGTH_FOR_SEARCH).
const PROTOCOL_MIN_NICKNAME = 3;
const PROTOCOL_MAX_NICKNAME = 32;

export function isUsernameValid(username: string): boolean {
  const nickname = getNickname(username);
  const discriminator = getDiscriminator(username);

  if (!nickname) {
    return false;
  }

  if (
    nickname.length < PROTOCOL_MIN_NICKNAME ||
    nickname.length > PROTOCOL_MAX_NICKNAME
  ) {
    return false;
  }

  if (!NICKNAME_CHARS.test(nickname)) {
    return false;
  }

  if (!discriminator || discriminator.length === 0) {
    return false;
  }
  if (discriminator.startsWith('0') && discriminator[1] === '0') {
    return false;
  }
  if (discriminator.startsWith('0') && discriminator.length !== 2) {
    return false;
  }

  return true;
}

export function getUsernameFromSearch(searchTerm: string): string | undefined {
  let modifiedTerm = searchTerm.trim();

  if (ALL_DIGITS.test(modifiedTerm)) {
    return undefined;
  }

  if (modifiedTerm.startsWith('@')) {
    modifiedTerm = modifiedTerm.slice(1);
  }

  if (!USERNAME_LIKE.test(modifiedTerm)) {
    return undefined;
  }

  // Tellomi (ADR-0066): a bare nickname means `<nickname>.01`, the only discriminator Tellomi clients set.
  // `kaixin.57` typed in full is looked up as typed (old usernames keep working).
  return withFixedDiscriminator(modifiedTerm);
}

export function isProbablyAUsername(text: string): boolean {
  const searchTerm = text.trim();

  if (searchTerm.startsWith('@')) {
    return true;
  }

  if (!USERNAME_LIKE.test(searchTerm)) {
    return false;
  }
  if (ALL_DIGITS.test(searchTerm)) {
    return false;
  }

  if (/.+\.\d\d\d?$/.test(searchTerm)) {
    return true;
  }

  return false;
}
