// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Bytes from '../../Bytes.std.ts';
import { parseLinkCard } from '../../linkPreviews/linkCard.std.ts';
import {
  _setLinkRegistryForTesting,
  classifyLinkPreview,
} from '../../linkPreviews/linkRegistry.preload.ts';

// ADR-0063 §5.1 rule 4 (tellomi/tellomi#1421): Desktop stores `Preview.rich` as base64 and names
// fields its own way; every golden `classify` case from rust/links, fed through Desktop's shape,
// must give exactly the card Rust gives.

type GoldenCase = Readonly<{
  name: string;
  preview: string;
  body: string;
  message: string;
  card: string;
}>;

type Golden = Readonly<{
  registry: string;
  classify: ReadonlyArray<GoldenCase>;
}>;

type GoldenPreview = Readonly<{
  url: string;
  title?: string;
  description?: string;
  has_image?: boolean;
  date?: number;
  rich?: string;
}>;

type GoldenMessage = Readonly<{
  is_story?: boolean;
  attachment_content_types?: ReadonlyArray<string>;
}>;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Golden = JSON.parse(
  readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8')
);

describe('classifyLinkPreview', () => {
  afterEach(() => {
    _setLinkRegistryForTesting(undefined);
  });

  it('gives the rust/links card for every golden case', () => {
    _setLinkRegistryForTesting(
      LinkRegistry.load(
        new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
      )
    );
    assert.isAtLeast(golden.classify.length, 40);

    for (const testCase of golden.classify) {
      const preview: GoldenPreview = JSON.parse(testCase.preview);
      const message: GoldenMessage = JSON.parse(testCase.message || '{}');
      const card = classifyLinkPreview(
        {
          url: preview.url,
          title: preview.title,
          description: preview.description,
          hasImage: preview.has_image ?? false,
          date: preview.date,
          rich: preview.rich
            ? Bytes.toBase64(Bytes.fromHex(preview.rich))
            : undefined,
        },
        testCase.body,
        {
          isStory: message.is_story ?? false,
          attachmentContentTypes: message.attachment_content_types ?? [],
        }
      );
      const expected = parseLinkCard(testCase.card);
      assert.isDefined(expected, `golden card parses: ${testCase.name}`);
      assert.deepEqual(card, expected, testCase.name);
    }
  });

  it('makes no decision without a registry', () => {
    // No `window.SignalContext` under test-node: loading the bundled file fails, and callers fall
    // back to showing the preview the way Signal does.
    assert.isUndefined(
      classifyLinkPreview(
        { url: 'https://example.com/', title: 'Example', hasImage: false },
        'https://example.com/',
        { isStory: false, attachmentContentTypes: [] }
      )
    );
  });
});
