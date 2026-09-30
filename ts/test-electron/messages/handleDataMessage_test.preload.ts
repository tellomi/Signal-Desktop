// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { v4 as uuid } from 'uuid';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import { handleDataMessage } from '../../messages/handleDataMessage.preload.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import { MessageModel } from '../../models/messages.preload.ts';
import { MessageCache } from '../../services/MessageCache.preload.ts';
import { DataWriter } from '../../sql/Client.preload.ts';
import { itemStorage } from '../../textsecure/Storage.preload.ts';
import type { ProcessedDataMessage } from '../../textsecure/Types.d.ts';
import type { AciString } from '../../types/ServiceId.std.ts';
import { DurationInSeconds } from '../../util/durations/duration-in-seconds.std.ts';
import { SignalService } from '../../protobuf/index.std.ts';
import {
  generateAci,
  generatePni,
} from '../../test-helpers/serviceIdUtils.std.ts';

describe('handleDataMessage', () => {
  let ourAci: AciString;

  beforeEach(async () => {
    ourAci = generateAci();
    MessageCache.install();
    await itemStorage.user.setAciAndDeviceId(ourAci, 1);
    await itemStorage.user.setPni(generatePni());

    window.ConversationController.reset();
    MessageCache.install();
    await window.ConversationController.load();
  });

  afterEach(async () => {
    await DataWriter.removeAll();
    await itemStorage.fetch();
    window.ConversationController.reset();
  });

  it('deduplicates incoming messages with same sender/timestamp, if existing message saved to DB', async () => {
    const senderAci = generateAci();
    const conversation = await window.ConversationController.getOrCreateAndWait(
      senderAci,
      'private'
    );
    const sentAt = Date.now();

    const existingAttributes: MessageAttributesType = {
      id: uuid(),
      conversationId: conversation.id,
      type: 'incoming',
      sourceServiceId: senderAci,
      sourceDevice: 1,
      sent_at: sentAt,
      timestamp: sentAt,
      received_at: sentAt,
    };

    await DataWriter.saveMessage(existingAttributes, {
      ourAci,
      forceSave: true,
      postSaveUpdates: () => Promise.resolve(),
    });

    const dataMessage: ProcessedDataMessage = {
      attachments: [],
      flags: 0,
      body: 'body',
      expireTimer: DurationInSeconds.fromDays(0),
      expireTimerVersion: 1,
      isViewOnce: false,
      timestamp: sentAt,
      requiredProtocolVersion:
        SignalService.DataMessage.ProtocolVersion.CURRENT,
    };

    const duplicateMessage = new MessageModel({
      id: uuid(),
      conversationId: conversation.id,
      type: 'incoming',
      sourceServiceId: senderAci,
      sourceDevice: 2,
      sent_at: sentAt,
      timestamp: sentAt,
      received_at: sentAt + 1,
    });

    const saveAndNotify = sinon.stub();
    const confirm = sinon.stub();

    await handleDataMessage(
      duplicateMessage,
      dataMessage,
      confirm,
      {},
      { saveAndNotify }
    );

    assert.strictEqual(saveAndNotify.callCount, 0, 'not saved');
    assert.strictEqual(confirm.callCount, 1, 'confirmed immediately');
  });

  it('deduplicates incoming messages with same sender/timestamp, if existing message only in memory', async () => {
    const senderAci = generateAci();
    const conversation = await window.ConversationController.getOrCreateAndWait(
      senderAci,
      'private'
    );
    const sentAt = Date.now();
    const dataMessage: ProcessedDataMessage = {
      attachments: [],
      flags: 0,
      body: 'body',
      expireTimer: DurationInSeconds.fromDays(0),
      expireTimerVersion: 1,
      isViewOnce: false,
      timestamp: sentAt,
      requiredProtocolVersion:
        SignalService.DataMessage.ProtocolVersion.CURRENT,
    };
    const saveAndNotify = sinon.stub();
    const confirm = sinon.stub();

    const attributes: MessageAttributesType = {
      id: uuid(),
      conversationId: conversation.id,
      type: 'incoming',
      sourceServiceId: senderAci,
      sourceDevice: 1,
      sent_at: sentAt,
      timestamp: sentAt,
      received_at: sentAt,
    };

    await handleDataMessage(
      new MessageModel(attributes),
      dataMessage,
      confirm,
      {},
      { saveAndNotify }
    );

    assert.strictEqual(saveAndNotify.callCount, 1, 'initial message saved');
    assert.strictEqual(confirm.callCount, 0, 'not confirmed until saved');

    // Calling it again with same message does not call saveAndNotify, but does confirm()
    await handleDataMessage(
      new MessageModel(attributes),
      dataMessage,
      confirm,
      {},
      { saveAndNotify }
    );

    assert.strictEqual(saveAndNotify.callCount, 1, 'not saved again');
    assert.strictEqual(confirm.callCount, 1, 'duplicate confirmed immediately');

    // Calling it again with different message but same aci/timestamp does not call
    // saveAndNotify, but does confirm()
    await handleDataMessage(
      new MessageModel({
        ...attributes,
        // we intentionally (if suboptimally) do not consider deviceId when deduplicating
        sourceDevice: 2,
        id: uuid(),
      }),
      dataMessage,
      confirm,
      {},
      { saveAndNotify }
    );

    assert.strictEqual(saveAndNotify.callCount, 1, 'not saved again');
    assert.strictEqual(confirm.callCount, 2, 'duplicate confirmed immediately');
  });

  // Tellomi (ADR-0063 §5.1 rule 2, a preview that goes wrong never becomes an error): a preview
  // whose link cannot be read is one preview lost, never the message it came in. Run with the
  // link registry the way the app runs, so what rust/links decides is in the path too.
  describe('a link preview whose link cannot be read', () => {
    const FIXTURES = join(cwd(), 'fixtures', 'links');

    beforeEach(() => {
      const { registry } = JSON.parse(
        readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8')
      );
      _setLinkRegistryForTesting(
        LinkRegistry.load(
          new Uint8Array(readFileSync(join(FIXTURES, registry)))
        )
      );
    });

    afterEach(() => {
      _setLinkRegistryForTesting(undefined);
    });

    async function receiveWithPreview(url: string): Promise<{
      saveAndNotify: sinon.SinonStub;
      body: string;
    }> {
      const senderAci = generateAci();
      const conversation =
        await window.ConversationController.getOrCreateAndWait(
          senderAci,
          'private'
        );
      const sentAt = Date.now();
      const body = `see ${url}`;
      const dataMessage: ProcessedDataMessage = {
        attachments: [],
        flags: 0,
        body,
        expireTimer: DurationInSeconds.fromDays(0),
        expireTimerVersion: 1,
        isViewOnce: false,
        timestamp: sentAt,
        requiredProtocolVersion:
          SignalService.DataMessage.ProtocolVersion.CURRENT,
        preview: [{ url, title: 'A title', description: '' }],
      };
      const message = new MessageModel({
        id: uuid(),
        conversationId: conversation.id,
        type: 'incoming',
        sourceServiceId: senderAci,
        sourceDevice: 1,
        sent_at: sentAt,
        timestamp: sentAt,
        received_at: sentAt,
      });
      const saveAndNotify = sinon.stub();

      await handleDataMessage(
        message,
        dataMessage,
        sinon.stub(),
        {},
        { saveAndNotify }
      );
      return { saveAndNotify, body };
    }

    for (const url of [
      'https://tell.cc/call#key=not-a-key',
      'https://tell.cc/call#room=1',
      'https://signal.link/call#key=bcdf-ghkm-npqr',
    ]) {
      it(`saves the message and only loses the preview of a call link whose key cannot be read (${url})`, async () => {
        const { saveAndNotify, body } = await receiveWithPreview(url);

        assert.strictEqual(saveAndNotify.callCount, 1, 'the message is saved');
        const [saved] = saveAndNotify.firstCall.args as [MessageModel];
        assert.strictEqual(saved.get('body'), body, 'with its text');
        assert.deepEqual(saved.get('preview'), [], 'without the preview');
      });
    }

    it('still keeps and marks the preview of a call link whose key can be read', async () => {
      const url =
        'https://tell.cc/call#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';
      const { saveAndNotify } = await receiveWithPreview(url);

      assert.strictEqual(saveAndNotify.callCount, 1, 'the message is saved');
      const [saved] = saveAndNotify.firstCall.args as [MessageModel];
      const [preview] = saved.get('preview') ?? [];
      assert.strictEqual(preview?.url, url);
      assert.isTrue(preview?.isCallLink);
      assert.match(preview?.callLinkRoomId ?? '', /^[\da-f]{64}$/);
    });

    // Nothing reads these when a message arrives: pinned, so the day something does, it says so.
    for (const url of [
      `https://tell.cc/s#pack_id=${'0123456789abcdef'.repeat(2)}&pack_key=zzzz`,
      'https://tell.cc/s#garbage',
      'https://tell.cc/g#!!!!garbage',
      'https://tell.cc/g#AAAA',
    ]) {
      it(`saves the message and keeps the preview of a sticker pack or group invite link with a broken # (${url})`, async () => {
        const { saveAndNotify, body } = await receiveWithPreview(url);

        assert.strictEqual(saveAndNotify.callCount, 1, 'the message is saved');
        const [saved] = saveAndNotify.firstCall.args as [MessageModel];
        assert.strictEqual(saved.get('body'), body);
        assert.deepEqual(
          (saved.get('preview') ?? []).map(item => item.url),
          [url]
        );
      });
    }
  });
});
