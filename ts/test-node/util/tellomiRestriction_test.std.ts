// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { HTTPError } from '../../types/HTTPError.std.ts';
import { UnauthorizedMessageSendError } from '../../textsecure/Errors.std.ts';
import {
  isTellomiRestrictionActive,
  parseTellomiRestriction,
  tellomiRestrictionFromSendError,
  tellomiRestrictionMessageKeys,
} from '../../util/tellomiRestriction.std.ts';

// Tellomi（tellomi/tellomi ADR-0078 §3.4）：服务端处置说明的解析与判定。
describe('tellomiRestriction', () => {
  const UNTIL = 1_792_000_000; // 秒
  const body = (extra: Record<string, unknown> = {}) => ({
    tellomiRestriction: {
      level: 'stranger',
      until: UNTIL,
      appeal: 'abuse@tellomi.app',
      case: '20261017-abcd1234',
      ...extra,
    },
  });

  it('parses the server body (seconds become milliseconds)', () => {
    assert.deepEqual(parseTellomiRestriction(body()), {
      level: 'stranger',
      until: UNTIL * 1000,
      appeal: 'abuse@tellomi.app',
      caseId: '20261017-abcd1234',
    });
  });

  it('keeps going without a case number, rejects anything malformed', () => {
    assert.isUndefined(
      parseTellomiRestriction(body({ case: undefined }))?.caseId
    );
    for (const bad of [
      undefined,
      '',
      {},
      { tellomiRestriction: null },
      body({ level: 'terminated' }),
      body({ until: 'soon' }),
      body({ until: -1 }),
      body({ appeal: 'not an address' }),
    ]) {
      assert.isUndefined(parseTellomiRestriction(bad), JSON.stringify(bad));
    }
    assert.isUndefined(
      parseTellomiRestriction(body({ case: 'has spaces <script>' }))?.caseId
    );
  });

  it('lapses at the deadline', () => {
    const r = parseTellomiRestriction(body());
    assert.isTrue(isTellomiRestrictionActive(r, UNTIL * 1000 - 1));
    assert.isFalse(isTellomiRestrictionActive(r, UNTIL * 1000));
    assert.isFalse(isTellomiRestrictionActive(undefined, 0));
  });

  it('finds the explanation inside a failed send', () => {
    const httpError = new HTTPError('promiseAjax: error response', {
      code: 403,
      headers: {},
      response: body({ level: 'all' }),
    });
    const sendError = new UnauthorizedMessageSendError(
      'aci-placeholder' as never,
      httpError
    );
    assert.strictEqual(
      tellomiRestrictionFromSendError(sendError)?.level,
      'all'
    );
    assert.strictEqual(
      tellomiRestrictionFromSendError(httpError)?.level,
      'all'
    );
    assert.isUndefined(
      tellomiRestrictionFromSendError(
        new HTTPError('x', { code: 403, headers: {}, response: 'Forbidden' })
      )
    );
  });

  it('picks the sentence for the level and the case number', () => {
    const stranger = parseTellomiRestriction(body());
    const all = parseTellomiRestriction(
      body({ level: 'all', case: undefined })
    );
    if (!stranger || !all) {
      throw new Error('fixtures should parse');
    }
    assert.deepEqual(tellomiRestrictionMessageKeys(stranger), {
      body: 'icu:TellomiRestriction__stranger',
      appeal: 'icu:TellomiRestriction__appeal--case',
    });
    assert.deepEqual(tellomiRestrictionMessageKeys(all), {
      body: 'icu:TellomiRestriction__all',
      appeal: 'icu:TellomiRestriction__appeal',
    });
  });
});
