// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import { findPreviewCandidates } from '../../services/LinkPreview.preload.ts';
import { shouldPreviewHref } from '../../types/LinkPreview.std.ts';

// owner 2026-10-17 (ADR-0063 §5.6), send side: the links the composer previews, with the real
// bundled registry. An http:// or scheme-less link the registry claims is previewed over https;
// one it does not claim stays as written, and Signal's `shouldPreviewHref` then has no preview
// for it.

const REGISTRY = join(cwd(), 'fixtures', 'links', 'links-2026092702.json');

function firstPreview(message: string): string | undefined {
  return findPreviewCandidates(message).find(shouldPreviewHref);
}

describe('findPreviewCandidates', () => {
  beforeEach(() => {
    _setLinkRegistryForTesting(LinkRegistry.load(readFileSync(REGISTRY)));
  });

  afterEach(() => {
    _setLinkRegistryForTesting(undefined);
  });

  it('previews an http or scheme-less link the registry claims over https', () => {
    assert.strictEqual(firstPreview('看 b23.tv/abc'), 'https://b23.tv/abc');
    assert.strictEqual(
      firstPreview('看 http://b23.tv/abc'),
      'https://b23.tv/abc'
    );
    assert.strictEqual(
      firstPreview('看 www.bilibili.com/video/BV1GJ411x7h7 吧'),
      'https://www.bilibili.com/video/BV1GJ411x7h7'
    );
    assert.strictEqual(
      firstPreview('http://xhslink.com/a/b'),
      'https://xhslink.com/a/b'
    );
  });

  it('has no preview for one it does not claim, nor for a first-party one', () => {
    assert.isUndefined(firstPreview('http://signal.org'));
    assert.isUndefined(firstPreview('signal.org/hello'));
    assert.isUndefined(firstPreview('http://tell.cc/g/abc'));
    assert.strictEqual(
      firstPreview('http://a.com https://signal.org/x'),
      'https://signal.org/x'
    );
  });

  // PM 2026-10-19 (ADR-0063 §5.6): Chinese after the host gets a preview, sent as written (the
  // raw IRI, as Android sends it, which every receiver already finds in the body).
  it('previews a link with Chinese in its path or query, cut at Chinese punctuation', () => {
    assert.strictEqual(
      firstPreview('看 https://zh.wikipedia.org/wiki/中国 吧'),
      'https://zh.wikipedia.org/wiki/中国'
    );
    assert.strictEqual(
      firstPreview('https://zh.wikipedia.org/wiki/中国，很好'),
      'https://zh.wikipedia.org/wiki/中国'
    );
    assert.strictEqual(
      firstPreview('搜 https://www.baidu.com/s?wd=天气。'),
      'https://www.baidu.com/s?wd=天气'
    );
    assert.isUndefined(
      firstPreview('https://zh.wikipedia.org/wiki/中\u200b国')
    );
  });

  // PM 2026-10-19: a link with a zero-width / bidi character gets no preview, not a shortened one
  it('has no preview for a link with a hidden character in it', () => {
    assert.isUndefined(firstPreview('https://signal.org/abc\ufeff'));
    assert.isUndefined(firstPreview('https://signal.org/a\u200bb'));
    assert.isUndefined(firstPreview('https://signal.org/abc\u200f next'));
    assert.strictEqual(
      firstPreview('https://signal.org/abc\u200e https://signal.org/ok'),
      'https://signal.org/ok'
    );
    assert.strictEqual(
      firstPreview('https://zh.wikipedia.org/wiki/中国，\u200b很好'),
      'https://zh.wikipedia.org/wiki/中国'
    );
    assert.strictEqual(
      firstPreview('https://signal.org/abc \u200b'),
      'https://signal.org/abc'
    );
  });

  it('leaves https links as Signal finds them', () => {
    assert.deepEqual(findPreviewCandidates('see https://b23.tv/abc'), [
      'https://b23.tv/abc',
    ]);
  });
});
