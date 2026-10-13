// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { getTellomiBubbleCaption } from '../../util/tellomiCaptions.std.ts';

// ADR-0075 §4.4, owner 2026-10-14 as Telegram: which caption the bubble shows.
describe('Tellomi: the caption a bubble shows (ADR-0075)', () => {
  it('leaves an ordinary message to its body', () => {
    assert.isUndefined(getTellomiBubbleCaption({}));
    assert.isUndefined(
      getTellomiBubbleCaption({ attachments: [{}, { caption: '' }] })
    );
    assert.isUndefined(getTellomiBubbleCaption({ tellomiMessageCaption: '' }));
  });

  it('shows the one caption there is, whoever has it', () => {
    assert.deepEqual(
      getTellomiBubbleCaption({
        tellomiMessageCaption: 'Trip',
        attachments: [{}, {}],
      }),
      { text: 'Trip' }
    );
    assert.deepEqual(
      getTellomiBubbleCaption({ attachments: [{}, { caption: 'Sunset' }] }),
      { text: 'Sunset' }
    );
  });

  it('with two or more, shows only the caption for the whole message', () => {
    assert.deepEqual(
      getTellomiBubbleCaption({
        tellomiMessageCaption: 'Trip',
        attachments: [{ caption: 'Sunset' }, {}],
      }),
      { text: 'Trip' }
    );
    assert.deepEqual(
      getTellomiBubbleCaption({
        attachments: [{ caption: 'Sunset' }, { caption: 'Beach' }],
      }),
      { text: undefined }
    );
  });
});
