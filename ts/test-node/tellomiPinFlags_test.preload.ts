// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import * as Bytes from '../Bytes.std.ts';
import { SignalService as Proto } from '../protobuf/index.std.ts';
import { processDataMessage } from '../textsecure/processDataMessage.preload.ts';
import { toTellomiPinProto } from '../textsecure/SendMessage.preload.ts';
import { generateAci } from '../test-helpers/serviceIdUtils.std.ts';
import { toAciObject } from '../util/ServiceId.node.ts';
import type { SendPinMessageType } from '../types/PinnedMessage.std.ts';
import { SentTimestampMs } from '@signalapp/types';

// ADR-0081 §4.1: `DataMessage.tellomi.pinForSelfOnly` (a pin for my own devices only, in a sync transcript) and
// `pinSilent` (a group pin that doesn't notify). Only true values are written, so an ordinary pin keeps upstream's
// bytes; the golden bytes are shared with iOS and Android (docs/signal/VERSIONS.md).
describe('Tellomi: pin flags (ADR-0081 §4.1)', () => {
  const TIMESTAMP = Date.now();
  const AUTHOR = generateAci();

  type Options = Readonly<{
    pin?: boolean;
    unpin?: boolean;
    pinForSelfOnly?: boolean;
    pinSilent?: boolean;
  }>;

  function params({
    pin = false,
    unpin = false,
    pinForSelfOnly = false,
    pinSilent = false,
  }: Options): Proto.DataMessage.Params {
    return {
      body: pin || unpin ? null : 'hello',
      attachments: null,
      groupV2: null,
      flags: null,
      expireTimer: null,
      expireTimerVersion: null,
      profileKey: null,
      timestamp: BigInt(TIMESTAMP),
      quote: null,
      contact: null,
      preview: null,
      sticker: null,
      requiredProtocolVersion: null,
      isViewOnce: null,
      reaction: null,
      delete: null,
      bodyRanges: null,
      groupCallUpdate: null,
      payment: null,
      storyContext: null,
      giftBadge: null,
      pollCreate: null,
      pollTerminate: null,
      pollVote: null,
      pinMessage: pin
        ? {
            targetAuthorAciBinary: toAciObject(AUTHOR).getRawUuidBytes(),
            targetSentTimestamp: BigInt(TIMESTAMP - 1000),
            pinDuration: { pinDurationForever: true },
          }
        : null,
      unpinMessage: unpin
        ? {
            targetAuthorAciBinary: toAciObject(AUTHOR).getRawUuidBytes(),
            targetSentTimestamp: BigInt(TIMESTAMP - 1000),
          }
        : null,
      adminDelete: null,
      tellomi:
        pinForSelfOnly || pinSilent
          ? {
              captionAboveMedia: null,
              messageCaption: null,
              viewOnceSeconds: null,
              pinForSelfOnly: pinForSelfOnly ? true : null,
              pinSilent: pinSilent ? true : null,
            }
          : null,
    };
  }

  function process(options: Options) {
    return processDataMessage(
      Proto.DataMessage.decode(Proto.DataMessage.encode(params(options))),
      TIMESTAMP,
      { _createName: () => 'random-path' }
    );
  }

  function onlyTellomi(options: Options): string {
    return Bytes.toHex(
      Proto.DataMessage.encode({
        ...params(options),
        body: null,
        timestamp: null,
        pinMessage: null,
        unpinMessage: null,
      })
    );
  }

  it('encodes and decodes the golden bytes shared by the three clients', () => {
    // DataMessage{tellomi{pinForSelfOnly = true}} = c23e022001; {pinSilent = true} = c23e022801
    assert.strictEqual(onlyTellomi({ pinForSelfOnly: true }), 'c23e022001');
    assert.strictEqual(onlyTellomi({ pinSilent: true }), 'c23e022801');
    assert.isTrue(
      Proto.DataMessage.decode(Bytes.fromHex('c23e022001')).tellomi
        ?.pinForSelfOnly
    );
    assert.isTrue(
      Proto.DataMessage.decode(Bytes.fromHex('c23e022801')).tellomi?.pinSilent
    );
  });

  it('keeps the flags only with a pin or an unpin', () => {
    const pin = process({ pin: true, pinForSelfOnly: true });
    assert.isDefined(pin.pinMessage);
    assert.isTrue(pin.tellomiPinForSelfOnly);

    assert.isTrue(
      process({ unpin: true, pinForSelfOnly: true }).tellomiPinForSelfOnly
    );
    assert.isTrue(process({ pin: true, pinSilent: true }).tellomiPinSilent);

    const unpinSilent = process({ unpin: true, pinSilent: true });
    assert.isUndefined(
      unpinSilent.tellomiPinSilent,
      'silent means nothing on an unpin'
    );

    const text = process({ pinForSelfOnly: true, pinSilent: true });
    assert.isUndefined(text.tellomiPinForSelfOnly);
    assert.isUndefined(text.tellomiPinSilent);

    const ordinary = process({ pin: true });
    assert.isUndefined(ordinary.tellomiPinForSelfOnly);
    assert.isUndefined(ordinary.tellomiPinSilent);
  });

  it('writes only true flags, so an ordinary pin keeps upstream bytes', () => {
    const pin: SendPinMessageType = {
      targetAuthorAci: AUTHOR,
      targetSentTimestamp: SentTimestampMs.fromNumber(TIMESTAMP - 1000),
      pinDurationSeconds: null,
    };
    assert.isNull(toTellomiPinProto(pin, undefined));
    assert.isNull(toTellomiPinProto(undefined, undefined));

    const forMe = toTellomiPinProto(
      { ...pin, tellomiForSelfOnly: true },
      undefined
    );
    assert.isTrue(forMe?.pinForSelfOnly);
    assert.isNull(forMe?.pinSilent);

    const silent = toTellomiPinProto(
      { ...pin, tellomiSilent: true },
      undefined
    );
    assert.isTrue(silent?.pinSilent);
    assert.isNull(silent?.pinForSelfOnly);

    const unpinForMe = toTellomiPinProto(undefined, {
      targetAuthorAci: AUTHOR,
      targetSentTimestamp: SentTimestampMs.fromNumber(TIMESTAMP - 1000),
      tellomiForSelfOnly: true,
    });
    assert.isTrue(unpinForMe?.pinForSelfOnly);
  });
});
