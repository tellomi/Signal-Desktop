// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import * as Bytes from '../Bytes.std.ts';
import { SignalService as Proto } from '../protobuf/index.std.ts';
import { processDataMessage } from '../textsecure/processDataMessage.preload.ts';
import {
  getTellomiViewOnceSeconds,
  getTellomiViewOnceViewerDurationMs,
} from '../util/tellomiViewOnceTimer.std.ts';
import { getMessageAttrsToPreserveAfterErase } from '../types/Message.std.ts';
import {
  getEmptyState,
  reducer as lightboxReducer,
} from '../state/ducks/lightbox.preload.ts';
import { getTellomiViewOnceSeconds as selectTellomiViewOnceSeconds } from '../state/selectors/lightbox.std.ts';
import type { StateType } from '../state/reducer.preload.ts';

// ADR-0079 (tellomi/tellomi#1714): a view-once photo / video that closes 3, 10 or 30 seconds after it is
// opened. Desktop can't send view-once; it shows the seconds on what it receives (and on what this
// account's phone sent) and closes the viewer when they run out.
describe('Tellomi: timed view-once (ADR-0079)', () => {
  const TIMESTAMP = Date.now();

  type Options = {
    isViewOnce: boolean | null;
    viewOnceSeconds: number | null;
  };

  function params({
    isViewOnce,
    viewOnceSeconds,
  }: Options): Proto.DataMessage.Params {
    return {
      body: null,
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
      isViewOnce,
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
      pinMessage: null,
      unpinMessage: null,
      adminDelete: null,
      tellomi:
        viewOnceSeconds == null
          ? null
          : {
              captionAboveMedia: null,
              messageCaption: null,
              viewOnceSeconds,
              pinForSelfOnly: null,
              pinSilent: null,
            },
    };
  }

  function dataMessage(options: Options): Proto.DataMessage {
    return Proto.DataMessage.decode(Proto.DataMessage.encode(params(options)));
  }

  function process(message: Proto.DataMessage) {
    return processDataMessage(message, TIMESTAMP, {
      _createName: () => 'random-path',
    });
  }

  it('decodes the golden bytes shared by the three clients', () => {
    // DataMessage{tellomi{viewOnceSeconds = 3}} = c23e021803, = 30 = c23e02181e
    assert.strictEqual(
      Proto.DataMessage.decode(Bytes.fromHex('c23e021803')).tellomi
        ?.viewOnceSeconds,
      3
    );
    assert.strictEqual(
      Proto.DataMessage.decode(Bytes.fromHex('c23e02181e')).tellomi
        ?.viewOnceSeconds,
      30
    );
    const onlyTellomi = Proto.DataMessage.encode({
      ...params({ isViewOnce: null, viewOnceSeconds: 3 }),
      timestamp: null,
    });
    assert.strictEqual(Bytes.toHex(onlyTellomi), 'c23e021803');
  });

  it('keeps the seconds of a view-once, and only 3, 10 or 30', () => {
    for (const seconds of [3, 10, 30]) {
      assert.strictEqual(
        process(dataMessage({ isViewOnce: true, viewOnceSeconds: seconds }))
          .tellomiViewOnceSeconds,
        seconds
      );
    }
    for (const seconds of [0, 1, 5, 60]) {
      assert.notProperty(
        process(dataMessage({ isViewOnce: true, viewOnceSeconds: seconds })),
        'tellomiViewOnceSeconds'
      );
    }
  });

  it('ignores the seconds without view-once, and an ordinary view-once has none', () => {
    assert.notProperty(
      process(dataMessage({ isViewOnce: false, viewOnceSeconds: 10 })),
      'tellomiViewOnceSeconds'
    );
    assert.notProperty(
      process(dataMessage({ isViewOnce: null, viewOnceSeconds: 10 })),
      'tellomiViewOnceSeconds'
    );
    const ordinary = process(
      dataMessage({ isViewOnce: true, viewOnceSeconds: null })
    );
    assert.isTrue(ordinary.isViewOnce);
    assert.notProperty(ordinary, 'tellomiViewOnceSeconds');
  });

  it('checks stored seconds the same way', () => {
    assert.strictEqual(
      getTellomiViewOnceSeconds({ isViewOnce: true, seconds: 10 }),
      10
    );
    assert.isUndefined(
      getTellomiViewOnceSeconds({ isViewOnce: false, seconds: 10 })
    );
    assert.isUndefined(
      getTellomiViewOnceSeconds({ isViewOnce: true, seconds: 7 })
    );
    assert.isUndefined(
      getTellomiViewOnceSeconds({ isViewOnce: true, seconds: undefined })
    );
  });

  it('keeps a photo open for the seconds and a video for the seconds or the whole video', () => {
    assert.strictEqual(getTellomiViewOnceViewerDurationMs(10), 10_000);
    assert.strictEqual(getTellomiViewOnceViewerDurationMs(10, 4.2), 10_000);
    assert.strictEqual(getTellomiViewOnceViewerDurationMs(3, 12.5), 12_500);
    assert.strictEqual(
      getTellomiViewOnceViewerDurationMs(3, Number.NaN),
      3_000
    );
    assert.strictEqual(
      getTellomiViewOnceViewerDurationMs(3, Number.POSITIVE_INFINITY),
      3_000
    );
  });

  it('keeps the seconds when a view-once is sent or viewed, not when it is deleted for everyone', () => {
    for (const reason of [
      'view-once-sent',
      'view-once-viewed',
      'view-once-expired',
      'view-once-invalid',
    ] as const) {
      assert.include(
        getMessageAttrsToPreserveAfterErase(reason),
        'tellomiViewOnceSeconds',
        reason
      );
    }
    assert.notInclude(
      getMessageAttrsToPreserveAfterErase('delete-for-everyone'),
      'tellomiViewOnceSeconds'
    );
  });

  it('gives the lightbox the seconds of the view-once it shows', () => {
    type Action = Parameters<typeof lightboxReducer>[1];
    const show = (
      isViewOnce: boolean,
      tellomiViewOnceSeconds: number | undefined
    ): Action => ({
      type: 'lightbox/SHOW',
      payload: {
        isViewOnce,
        ...(tellomiViewOnceSeconds != null ? { tellomiViewOnceSeconds } : {}),
        media: [],
        hasPrevMessage: false,
        hasNextMessage: false,
        selectedIndex: undefined,
      },
    });
    const select = (action: Action) =>
      selectTellomiViewOnceSeconds({
        lightbox: lightboxReducer(getEmptyState(), action),
      } as unknown as StateType);

    assert.strictEqual(select(show(true, 10)), 10);
    assert.isUndefined(select(show(true, undefined)));
    assert.isUndefined(select(show(false, 10)));
    assert.isUndefined(select({ type: 'lightbox/CLOSE' }));
  });
});
