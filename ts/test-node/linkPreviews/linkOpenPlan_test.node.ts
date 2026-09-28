// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import {
  getDesktopOpenAction,
  parseLinkOpenPlan,
} from '../../linkPreviews/linkOpenPlan.std.ts';

// ADR-0063 §4.9 / §5.5 / §6.1 (tellomi/tellomi#1421): how Desktop opens a link.

type Golden = Readonly<{
  registry: string;
  open_plan: ReadonlyArray<Readonly<{ url: string; plan: string }>>;
}>;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Golden = JSON.parse(
  readFileSync(join(FIXTURES, 'open-plan-golden.json'), 'utf8')
);

function openPlan(url: string) {
  const registry = LinkRegistry.load(
    new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
  );
  return parseLinkOpenPlan(registry.openPlan(url));
}

describe('getDesktopOpenAction', () => {
  it('always targets the link itself, or nothing (golden open plans)', () => {
    assert.isAtLeast(golden.open_plan.length, 5);
    for (const { url, plan: json } of golden.open_plan) {
      const plan = parseLinkOpenPlan(json);
      assert.isDefined(plan, `golden plan parses: ${url}`);
      const action = getDesktopOpenAction(url, plan);
      if (plan?.steps.length === 0) {
        assert.deepEqual(action, { type: 'none' }, url);
      } else {
        assert.strictEqual(action.type, 'browser', url);
        assert.strictEqual(action.type === 'browser' && action.url, url, url);
        assert.strictEqual(
          action.type === 'browser' && action.lookalike,
          plan?.lookalike ?? undefined,
          url
        );
      }
    }
  });

  it('warns before opening a lookalike domain', () => {
    const url = 'https://www.bi1ibili.com/video/BV1YDhJ6ZEL6';
    assert.deepEqual(getDesktopOpenAction(url, openPlan(url)), {
      type: 'browser',
      url,
      lookalike: 'bilibili.com',
      copyOnFailure: true,
    });
  });

  it('never opens a non-http(s) target', () => {
    const url = 'intent://scan/#Intent;scheme=zxing;end';
    assert.deepEqual(getDesktopOpenAction(url, openPlan(url)), {
      type: 'none',
    });
  });

  it('sends payment links to the browser like any other on Desktop', () => {
    const url = 'https://render.alipay.com/p/f/fd-j5rqp49m/index.html';
    assert.deepEqual(getDesktopOpenAction(url, openPlan(url)), {
      type: 'browser',
      url,
      lookalike: undefined,
      copyOnFailure: true,
    });
  });

  it('opens the way Signal does without a registry', () => {
    const url = 'https://example.com/';
    assert.deepEqual(getDesktopOpenAction(url, undefined), {
      type: 'browser',
      url,
      lookalike: undefined,
      copyOnFailure: false,
    });
  });
});
