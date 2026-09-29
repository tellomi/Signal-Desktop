// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { HTTPError } from '../../types/HTTPError.std.ts';
import {
  isGroupLinkInactiveError,
  toLinkFirstPartyResult,
} from '../../linkPreviews/groupLinkState.std.ts';

// ADR-0063 §5.1 rule 2 / §8.1 row 4 (tellomi/tellomi#1421): what the sender's own lookup of a
// tell.cc object tells rust/links.

function httpError(code: number, headers: Record<string, string> = {}) {
  return new HTTPError('request failed', { code, headers });
}

describe('isGroupLinkInactiveError', () => {
  it('is true when the server refuses the link or the group is gone', () => {
    assert.isTrue(isGroupLinkInactiveError(httpError(403)));
    assert.isTrue(isGroupLinkInactiveError(httpError(423)));
  });

  it('is false for a ban, which says nothing about the link', () => {
    assert.isFalse(
      isGroupLinkInactiveError(
        httpError(403, { 'x-signal-forbidden-reason': 'banned' })
      )
    );
  });

  it('is false for anything that may work next time', () => {
    for (const code of [401, 404, 429, 500, 503]) {
      assert.isFalse(isGroupLinkInactiveError(httpError(code)), String(code));
    }
    assert.isFalse(isGroupLinkInactiveError(new Error('socket hang up')));
    assert.isFalse(isGroupLinkInactiveError(undefined));
  });
});

describe('toLinkFirstPartyResult', () => {
  it('passes the name and the member count of a group', () => {
    assert.deepEqual(
      toLinkFirstPartyResult({ title: '周末爬山群', memberCount: 12 }),
      { ok: true, title: '周末爬山群', member_count: 12 }
    );
  });

  it('passes the sticker count of a pack', () => {
    assert.deepEqual(
      toLinkFirstPartyResult({ title: 'Bandit', stickerCount: 24 }),
      { ok: true, title: 'Bandit', sticker_count: 24 }
    );
  });

  it('leaves out counts that are not a whole number above zero', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      assert.deepEqual(
        toLinkFirstPartyResult({
          title: 'G',
          memberCount: count,
          stickerCount: count,
        }),
        { ok: true, title: 'G' },
        String(count)
      );
    }
  });

  it('leaves out an empty name', () => {
    assert.deepEqual(toLinkFirstPartyResult({ title: null }), { ok: true });
    assert.deepEqual(toLinkFirstPartyResult({ title: '' }), { ok: true });
  });

  it('says nothing was found, or that the group link is not active', () => {
    assert.deepEqual(toLinkFirstPartyResult(null), { ok: false });
    assert.deepEqual(toLinkFirstPartyResult('inactive'), {
      ok: false,
      invalid: true,
    });
  });
});
