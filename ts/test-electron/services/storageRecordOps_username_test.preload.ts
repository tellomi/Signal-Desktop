// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { DataWriter } from '../../sql/Client.preload.ts';
import { itemStorage } from '../../textsecure/Storage.preload.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import {
  mergeAccountRecord,
  toAccountRecord,
} from '../../services/storageRecordOps.preload.ts';
import {
  generateAci,
  generatePni,
} from '../../test-helpers/serviceIdUtils.std.ts';
import type { ConversationModel } from '../../models/conversations.preload.ts';

// Tellomi (ADR-0066 §6.2, tellomi/tellomi#1247): a storage sync that clears our username means another device deleted
// it. mergeAccountRecord must then record the deletion time that the username editor warns from
// (tellomiUsernameDeletedAt, see getUsernameSaveConfirmation); these pin that wiring, not just the pure predicate.
describe('mergeAccountRecord: Tellomi username deletion time', () => {
  const OUR_ACI = generateAci();
  const OUR_PNI = generatePni();
  let ourConversation: ConversationModel;

  beforeEach(async () => {
    await DataWriter.removeAll();
    await itemStorage.user.setCredentials({
      number: '+15550000000',
      aci: OUR_ACI,
      pni: OUR_PNI,
      deviceId: 2,
      deviceName: 'my device',
      password: 'password',
    });

    window.ConversationController.reset();
    await window.ConversationController.load();

    ourConversation = window.ConversationController.getOrCreate(
      OUR_ACI,
      'private'
    );
    await itemStorage.remove('tellomiUsernameDeletedAt');
  });

  // Merges an AccountRecord that matches local state except for the username, the way a storage sync delivers it.
  async function syncUsername(
    previous: string | undefined,
    synced: string
  ): Promise<void> {
    await ourConversation.updateUsername(previous, { shouldSave: false });
    const signalConversation =
      await window.ConversationController.getOrCreateSignalConversation();
    const local = toAccountRecord({
      ourConversation,
      signalConversation,
      notificationProfileSyncDisabled: false,
    });
    const { record } = Proto.StorageRecord.decode(
      Proto.StorageRecord.encode({
        record: { account: { ...local, username: synced } },
      })
    );
    const account = record?.account;
    if (!account) {
      throw new Error('Expected an AccountRecord');
    }
    await mergeAccountRecord('storage-id', 1, account);
  }

  it('records the deletion time when a sync clears our username', async () => {
    const before = Date.now();
    await syncUsername('kaixin.01', '');

    const deletedAt = itemStorage.get('tellomiUsernameDeletedAt');
    assert.isNumber(deletedAt);
    assert.isAtLeast(deletedAt ?? 0, before);
    assert.isAtMost(deletedAt ?? 0, Date.now());
    assert.isUndefined(ourConversation.get('username'));
  });

  it('does not record when a sync replaces our username', async () => {
    await syncUsername('kaixin.01', 'bob.01');

    assert.isUndefined(itemStorage.get('tellomiUsernameDeletedAt'));
    assert.strictEqual(ourConversation.get('username'), 'bob.01');
  });

  it('does not record when there was no username before the sync', async () => {
    await syncUsername(undefined, '');

    assert.isUndefined(itemStorage.get('tellomiUsernameDeletedAt'));
  });
});
