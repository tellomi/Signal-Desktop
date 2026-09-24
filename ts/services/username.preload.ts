// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import {
  usernames,
  LibSignalErrorBase,
  ErrorCode,
} from '@signalapp/libsignal-client';

import { singleProtoJobQueue } from '../jobs/singleProtoJobQueue.preload.ts';
import { strictAssert } from '../util/assert.std.ts';
import { SECOND } from '../util/durations/index.std.ts';
import { sleep } from '../util/sleep.std.ts';
import { getMinNickname, getMaxNickname } from '../util/Username.dom.ts';
import { bytesToUuid, uuidToBytes } from '../util/uuidToBytes.std.ts';
import type { UsernameReservationType } from '../types/Username.std.ts';
import {
  ReserveUsernameError,
  ConfirmUsernameResult,
  isCaseChange,
  isRenameCooldown,
  planUsernameReservation,
} from '../types/Username.std.ts';
import * as Errors from '../types/errors.std.ts';
import { createLogger } from '../logging/log.std.ts';
import { MessageSender } from '../textsecure/SendMessage.preload.ts';
import {
  reserveUsername as doReserveUsername,
  replaceUsernameLink,
  confirmUsername as doConfirmUsername,
  deleteUsername as doDeleteUsername,
  resolveUsernameLink,
} from '../textsecure/WebAPI.preload.ts';
import type { ResolveUsernameByLinkOptionsType } from '../textsecure/WebAPI.preload.ts';
import { HTTPError } from '../types/HTTPError.std.ts';
import { findRetryAfterTimeFromError } from '../jobs/helpers/findRetryAfterTimeFromError.std.ts';
import * as Bytes from '../Bytes.std.ts';
import { runStorageServiceUploadJob } from './storage.preload.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';

const log = createLogger('username');

export type WriteUsernameOptionsType = Readonly<
  | {
      reservation: UsernameReservationType;
    }
  | {
      username: undefined;
      previousUsername: string | undefined;
      reservation?: undefined;
    }
>;

// Tellomi (ADR-0066): there is no user-chosen discriminator any more, so no `customDiscriminator` here.
export type ReserveUsernameOptionsType = Readonly<{
  nickname: string;
  previousUsername: string | undefined;
  abortSignal?: AbortSignal;
}>;

export type ReserveUsernameResultType = Readonly<
  | {
      ok: true;
      reservation: UsernameReservationType;
      error?: void;
    }
  | {
      ok: false;
      reservation?: void;
      error: ReserveUsernameError;
      // Only for ReserveUsernameError.ChangeCooldown: seconds until the account may take a new username.
      retryAfterSecs?: number;
    }
>;

export async function reserveUsername(
  options: ReserveUsernameOptionsType
): Promise<ReserveUsernameResultType> {
  const { nickname, previousUsername, abortSignal } = options;

  const me = window.ConversationController.getOurConversationOrThrow();

  if (me.get('username') !== previousUsername) {
    throw new Error('reserveUsername: Username has changed on another device');
  }

  try {
    // Tellomi (ADR-0066): the rules live in planUsernameReservation — one candidate `<nickname>.01`, the case-only
    // shortcut only for a current `.01`, every reservation starts with a letter and has at most 20 characters.
    const plan = planUsernameReservation(nickname, previousUsername);

    if (plan.kind === 'caseChange') {
      // The hash is case-insensitive, so the current username is re-confirmed with the new casing and nothing is
      // reserved.
      const hash = usernames.hash(plan.username);
      return {
        ok: true,
        reservation: { previousUsername, username: plan.username, hash },
      };
    }

    if (plan.kind === 'invalid') {
      return { ok: false, error: plan.error };
    }

    // Uniqueness of the hash means uniqueness of the nickname; a taken or reserved nickname is a 409.
    const candidates = plan.candidates.map(
      candidate =>
        usernames.fromParts(
          candidate.nickname,
          candidate.discriminator,
          getMinNickname(),
          getMaxNickname()
        ).username
    );

    const hashes = candidates.map(username => usernames.hash(username));

    const { usernameHash } = await doReserveUsername({
      hashes,
      abortSignal,
    });

    const index = hashes.findIndex(hash => Bytes.areEqual(hash, usernameHash));
    if (index === -1) {
      log.warn('reserveUsername: failed to find username hash in the response');
      return { ok: false, error: ReserveUsernameError.Unprocessable };
    }

    // oxlint-disable-next-line typescript/no-non-null-assertion
    const username = candidates[index]!;

    return {
      ok: true,
      reservation: { previousUsername, username, hash: usernameHash },
    };
  } catch (error) {
    if (error instanceof LibSignalErrorBase) {
      if (error.is(ErrorCode.UsernameNotAvailable)) {
        return { ok: false, error: ReserveUsernameError.Conflict };
      }
      if (error.is(ErrorCode.RateLimitedError)) {
        // Tellomi (ADR-0066 §6.2): the 30-day rename cooldown is a 429 too, told apart by its Retry-After.
        // Only reservations are refused for it; confirming (below) is not, so its sleep-and-retry stays as upstream.
        if (isRenameCooldown(error.retryAfterSecs)) {
          return {
            ok: false,
            error: ReserveUsernameError.ChangeCooldown,
            retryAfterSecs: error.retryAfterSecs,
          };
        }
        return {
          ok: false,
          error: ReserveUsernameError.TooManyAttempts,
        };
      }
      if (
        error.is(ErrorCode.NicknameCannotBeEmpty) ||
        error.is(ErrorCode.NicknameTooShort)
      ) {
        return {
          ok: false,
          error: ReserveUsernameError.NotEnoughCharacters,
        };
      }
      if (error.is(ErrorCode.NicknameTooLong)) {
        return {
          ok: false,
          error: ReserveUsernameError.TooManyCharacters,
        };
      }
      if (error.is(ErrorCode.CannotStartWithDigit)) {
        return {
          ok: false,
          error: ReserveUsernameError.CheckStartingCharacter,
        };
      }
      if (error.is(ErrorCode.BadNicknameCharacter)) {
        return {
          ok: false,
          error: ReserveUsernameError.CheckCharacters,
        };
      }

      if (error.is(ErrorCode.DiscriminatorCannotBeZero)) {
        return {
          ok: false,
          error: ReserveUsernameError.AllZeroDiscriminator,
        };
      }

      if (error.is(ErrorCode.DiscriminatorCannotHaveLeadingZeros)) {
        return {
          ok: false,
          error: ReserveUsernameError.LeadingZeroDiscriminator,
        };
      }

      if (
        error.is(ErrorCode.DiscriminatorCannotBeEmpty) ||
        error.is(ErrorCode.DiscriminatorCannotBeSingleDigit) ||
        // This is handled on UI level
        error.is(ErrorCode.DiscriminatorTooLarge)
      ) {
        return {
          ok: false,
          error: ReserveUsernameError.NotEnoughDiscriminator,
        };
      }
    }
    throw error;
  }
}

async function updateUsernameAndSyncProfile(
  username: string | undefined
): Promise<void> {
  const me = window.ConversationController.getOurConversationOrThrow();

  // Update model, update DB
  await me.updateUsername(username);

  if (!window.ConversationController.doWeHaveOtherDevices()) {
    return;
  }

  // then tell our other devices about profile update, username
  try {
    await singleProtoJobQueue.add(
      MessageSender.getFetchLocalProfileSyncMessage()
    );
  } catch (error) {
    log.error(
      'updateUsernameAndSyncProfile: Failed to queue sync message',
      Errors.toLogFormat(error)
    );
  }
}

export async function confirmUsername(
  reservation: UsernameReservationType,
  abortSignal?: AbortSignal
): Promise<ConfirmUsernameResult> {
  const { previousUsername, username } = reservation;
  const previousLink = itemStorage.get('usernameLink');

  const me = window.ConversationController.getOurConversationOrThrow();

  if (me.get('username') !== previousUsername) {
    throw new Error('Username has changed on another device');
  }

  const { hash } = reservation;
  strictAssert(
    Bytes.areEqual(usernames.hash(username), hash),
    'username hash mismatch'
  );

  const wasCorrupted = itemStorage.get('usernameCorrupted');

  try {
    await itemStorage.remove('usernameLink');

    let serverIdString: string;
    let entropy: Uint8Array<ArrayBuffer>;
    if (previousLink && isCaseChange(reservation)) {
      log.info('confirmUsername: updating link only');

      const updatedLink = usernames.createUsernameLink(
        username,
        previousLink.entropy
      );
      ({ entropy } = updatedLink);

      ({ usernameLinkHandle: serverIdString } = await replaceUsernameLink({
        encryptedUsername: updatedLink.encryptedUsername,
        keepLinkHandle: true,
      }));
    } else {
      log.info('confirmUsername: confirming and replacing link');

      const newLink = usernames.createUsernameLink(username);
      ({ entropy } = newLink);

      const proof = usernames.generateProof(username);

      ({ usernameLinkHandle: serverIdString } = await doConfirmUsername({
        hash,
        proof,
        encryptedUsername: newLink.encryptedUsername,
        abortSignal,
      }));
    }

    await itemStorage.put('usernameLink', {
      entropy,
      serverId: uuidToBytes(serverIdString),
    });

    await updateUsernameAndSyncProfile(username);
    await itemStorage.remove('usernameCorrupted');
    await itemStorage.remove('usernameLinkCorrupted');
  } catch (error) {
    if (error instanceof HTTPError) {
      if (error.code === 413 || error.code === 429) {
        const time = findRetryAfterTimeFromError(error);
        log.warn(`confirmUsername: got ${error.code}, waiting ${time}ms`);
        await sleep(time, abortSignal);

        return confirmUsername(reservation, abortSignal);
      }

      if (error.code === 409 || error.code === 410) {
        return ConfirmUsernameResult.ConflictOrGone;
      }
    }
    if (error instanceof LibSignalErrorBase) {
      if (error.is(ErrorCode.RateLimitedError)) {
        const time = error.retryAfterSecs * SECOND;
        log.warn(`confirmUsername: rate limited, waiting ${time}ms`);
        await sleep(time, abortSignal);

        return confirmUsername(reservation, abortSignal);
      }

      if (error.is(ErrorCode.UsernameNotSet)) {
        return ConfirmUsernameResult.ConflictOrGone;
      }
    }
    throw error;
  }

  return wasCorrupted
    ? ConfirmUsernameResult.OkRecovered
    : ConfirmUsernameResult.Ok;
}

export async function deleteUsername(
  previousUsername: string | undefined,
  abortSignal?: AbortSignal
): Promise<void> {
  const me = window.ConversationController.getOurConversationOrThrow();

  if (me.get('username') !== previousUsername) {
    throw new Error('Username has changed on another device');
  }

  await itemStorage.remove('usernameLink');
  await doDeleteUsername(abortSignal);
  await itemStorage.remove('usernameCorrupted');
  // Tellomi (ADR-0066 §6.2): the server now holds the old username for USERNAME_HOLD_DAYS, and setting any username
  // while it does starts the rename cooldown. Remember when, so the editor can warn before that.
  await itemStorage.put('tellomiUsernameDeletedAt', Date.now());
  await updateUsernameAndSyncProfile(undefined);
}

export async function resetLink(username: string): Promise<void> {
  const me = window.ConversationController.getOurConversationOrThrow();

  if (me.get('username') !== username) {
    throw new Error('Username has changed on another device');
  }

  const { entropy, encryptedUsername } = usernames.createUsernameLink(username);

  await itemStorage.remove('usernameLink');

  const { usernameLinkHandle: serverIdString } = await replaceUsernameLink({
    encryptedUsername,
    keepLinkHandle: false,
  });

  await itemStorage.put('usernameLink', {
    entropy,
    serverId: uuidToBytes(serverIdString),
  });
  await itemStorage.remove('usernameLinkCorrupted');

  me.captureChange('usernameLink');
  runStorageServiceUploadJob({ reason: 'resetLink' });
}

const USERNAME_LINK_ENTROPY_SIZE = 32;

export async function resolveUsernameByLinkBase64(
  base64: string
): Promise<string | undefined> {
  const content = Bytes.fromBase64(base64);
  const entropy = content.subarray(0, USERNAME_LINK_ENTROPY_SIZE);
  const serverId = content.subarray(USERNAME_LINK_ENTROPY_SIZE);

  const uuid = bytesToUuid(serverId);
  strictAssert(uuid, 'Failed to re-encode server id as uuid');

  return resolveUsernameByLink({ entropy, uuid });
}

async function resolveUsernameByLink(
  options: ResolveUsernameByLinkOptionsType
): Promise<string | undefined> {
  try {
    const result = await resolveUsernameLink(options);
    if (!result) {
      return undefined;
    }

    return result.username;
  } catch (error) {
    if (error instanceof HTTPError && error.code === 404) {
      return undefined;
    }
    throw error;
  }
}

export function hasUsernameChangeSyncCapability(): boolean {
  const ourConversation =
    window.ConversationController.getOurConversationOrThrow();

  return (
    ourConversation.get('capabilities')?.usernameChangeSyncMessage === true
  );
}

export async function sendUsernameChangeSyncMessage(): Promise<void> {
  if (!hasUsernameChangeSyncCapability()) {
    return;
  }

  await singleProtoJobQueue.add(MessageSender.getUsernameChangeSyncMessage());
}
