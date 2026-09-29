// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { getLinkErrorKind } from '../../linkPreviews/linkLog.std.ts';

// ADR-0063 §6.5 / §8.1 row 9 (tellomi/tellomi#1421): link logs never carry the URL or its `#`
// part, even when an error message quotes it.

const CANARY = 'https://www.bilibili.com/video/canary7f3a#canary7f3a';

describe('getLinkErrorKind', () => {
  it('names the kind of error without its message', () => {
    const kind = getLinkErrorKind(new Error(`failed to open ${CANARY}`));
    assert.strictEqual(kind, 'Error');
    assert.notInclude(kind, 'canary7f3a');

    assert.strictEqual(
      getLinkErrorKind(new TypeError(`Invalid URL: ${CANARY}`)),
      'TypeError'
    );
  });

  it('adds a short error code', () => {
    const error = Object.assign(new Error(CANARY), { code: 'ENOENT' });
    assert.strictEqual(getLinkErrorKind(error), 'Error(ENOENT)');
    assert.strictEqual(
      getLinkErrorKind(Object.assign(new Error(CANARY), { code: 7 })),
      'Error(7)'
    );
  });

  it('drops a code that could be anything', () => {
    const error = Object.assign(new Error('x'), { code: CANARY });
    assert.strictEqual(getLinkErrorKind(error), 'Error');
  });

  it('names what was thrown when it is not an Error', () => {
    assert.strictEqual(getLinkErrorKind(CANARY), 'string');
    assert.strictEqual(getLinkErrorKind({ url: CANARY }), 'object');
    assert.strictEqual(getLinkErrorKind(undefined), 'undefined');
  });
});
