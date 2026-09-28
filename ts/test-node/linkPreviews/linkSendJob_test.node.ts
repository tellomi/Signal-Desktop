// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Bytes from '../../Bytes.std.ts';
import type { LinkFetchResult } from '../../linkPreviews/linkFetchTypes.std.ts';
import {
  LINK_BUDGET_MS,
  parseLinkSendOutcome,
  runLinkSendJob,
  toLinkPreviewResult,
} from '../../linkPreviews/linkSendJob.std.ts';

// ADR-0063 §4.2 / §4.4 (tellomi/tellomi#1421): Desktop drives rust/links' send job. Every golden
// `send` case from rust/links is replayed with its scripted responses: the requests Desktop is
// asked to make, and the finished outcome, must match Rust's byte for byte.

type ScriptedResponse = Readonly<{
  body?: string;
  content_type?: string;
  final_url?: string;
  status?: number;
  location?: string;
}>;

type SendCase = Readonly<{
  name: string;
  url: string;
  context: string;
  requests: ReadonlyArray<string>;
  outcome: string;
  script: Readonly<{
    responses?: Record<string, ScriptedResponse>;
    network_error?: ReadonlyArray<string>;
    image_ok?: boolean;
    first_party?: string;
  }>;
}>;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{ registry: string; send: ReadonlyArray<SendCase> }> =
  JSON.parse(readFileSync(join(FIXTURES, 'send-golden.json'), 'utf8'));

function registry(): LinkRegistry {
  return LinkRegistry.load(
    new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
  );
}

describe('runLinkSendJob', () => {
  it('replays every golden send case exactly', async () => {
    assert.isAtLeast(golden.send.length, 5);
    const links = registry();

    for (const testCase of golden.send) {
      const { script } = testCase;
      const context = JSON.parse(testCase.context) as {
        locale?: string;
        unreachable_hosts?: Array<string>;
        expand_short_links?: boolean;
      };
      const issued: Array<string> = [];
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runLinkSendJob(
        testCase.url,
        {
          locale: context.locale ?? '',
          unreachableHosts: context.unreachable_hosts ?? [],
          expandShortLinks: context.expand_short_links ?? true,
        },
        {
          begin: (url, contextJson) => links.begin(url, contextJson),
          fetch: async (request): Promise<LinkFetchResult> => {
            if (script.network_error?.includes(request.url)) {
              return { type: 'network_error' };
            }
            if (request.kind === 'image') {
              return {
                type: 'response',
                status: 200,
                finalUrl: request.url,
                contentType: 'image/jpeg',
                location: null,
                body: new Uint8Array([1, 2, 3]),
                redirects: 0,
              };
            }
            const response = script.responses?.[request.url];
            if (!response) {
              return { type: 'failure', reason: 'other' };
            }
            return {
              type: 'response',
              status: response.status ?? 200,
              finalUrl: response.final_url ?? request.url,
              contentType: response.content_type ?? '',
              location: response.location ?? null,
              body: Bytes.fromString(response.body ?? ''),
              redirects: 0,
            };
          },
          firstParty: async () => JSON.parse(script.first_party ?? '{}'),
          acceptImage: async () => script.image_ok ?? true,
          now: () => 0,
          onRequest: json => issued.push(json),
        }
      );

      assert.deepEqual(issued, testCase.requests, `${testCase.name}: requests`);
      const expected = parseLinkSendOutcome(testCase.outcome);
      assert.isDefined(expected, `${testCase.name}: golden outcome parses`);
      assert.deepEqual(outcome, expected, `${testCase.name}: outcome`);
    }
  });

  it('stops asking for requests once the 10 s budget is spent', async () => {
    const links = registry();
    let clock = 0;
    const issued: Array<string> = [];
    const outcome = await runLinkSendJob(
      'https://apps.apple.com/cn/app/wechat/id414478124',
      { locale: 'zh-Hans', unreachableHosts: [], expandShortLinks: true },
      {
        begin: (url, contextJson) => links.begin(url, contextJson),
        fetch: async () => {
          clock += LINK_BUDGET_MS + 1;
          return { type: 'failure', reason: 'timeout' };
        },
        firstParty: async () => ({ ok: false }),
        acceptImage: async () => true,
        now: () => clock,
        onRequest: json => issued.push(json),
      }
    );
    assert.strictEqual(issued.length, 1);
    assert.strictEqual(outcome?.level, 'brand');
  });

  it('returns nothing when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runLinkSendJob(
      'https://apps.apple.com/cn/app/wechat/id414478124',
      { locale: '', unreachableHosts: [], expandShortLinks: true },
      {
        begin: (url, contextJson) => registry().begin(url, contextJson),
        fetch: async () => ({ type: 'network_error' }),
        firstParty: async () => ({ ok: false }),
        acceptImage: async () => true,
        now: () => 0,
      },
      controller.signal
    );
    assert.isUndefined(outcome);
  });

  it("turns the outcome into Desktop's preview, rich as base64", () => {
    const appStore = golden.send.find(({ name }) =>
      name.startsWith('App Store')
    );
    const outcome = parseLinkSendOutcome(appStore?.outcome ?? '');
    assert.isDefined(outcome?.preview);
    if (!outcome?.preview) {
      return;
    }
    const image = { marker: 'processed image' };
    const result = toLinkPreviewResult(outcome.preview, image);
    assert.deepEqual(result, {
      url: 'https://apps.apple.com/cn/app/wechat/id414478124',
      title: '微信',
      description: null,
      date: null,
      image,
      rich: Bytes.toBase64(Bytes.fromHex(outcome.preview.rich_hex ?? '')),
    });
    assert.isAbove(result.rich?.length ?? 0, 0);
    assert.isUndefined(
      toLinkPreviewResult({ ...outcome.preview, rich_hex: null }, undefined)
        .rich
    );
  });
});
