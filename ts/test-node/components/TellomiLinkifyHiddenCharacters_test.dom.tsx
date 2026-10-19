// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';

import { Linkify } from '../../components/conversation/Linkify.dom.tsx';
import { extractLinks } from '../../components/conversation/MessageTextRenderer.dom.tsx';

// Tellomi (PM 2026-10-19, ADR-0063 §5.6): a link with a zero-width or bidi character in it gets no
// preview and is not clickable either, the same as on iOS and Android.
describe('<Linkify /> with hidden characters (Tellomi)', () => {
  function anchors(text: string): Array<string> {
    const html = renderToStaticMarkup(<Linkify text={text} />);
    return [...html.matchAll(/<a href="([^"]*)">/g)].map(m => m[1] ?? '');
  }

  it('does not make a link with a hidden character in it clickable', () => {
    assert.deepEqual(anchors('https://signal.org/a\u200bb'), []);
    assert.deepEqual(anchors('see https://signal.org/abc\u200f next'), []);
    assert.deepEqual(anchors('https://signal.org/a,b\u200fc'), []);
    assert.deepEqual(anchors('https://signal.org/abc\u2060'), []);
    assert.deepEqual(anchors('https://signal.org/abc\ufeff x'), []);
    assert.deepEqual(anchors('https://signal.org/abc\u2066x'), []);
    assert.deepEqual(anchors('https://zh.wikipedia.org/wiki/中国\u200b'), []);
  });

  it('keeps the text of such a link', () => {
    const html = renderToStaticMarkup(
      <Linkify text={'see https://signal.org/a\u200bb'} />
    );
    assert.include(html, 'https://signal.org/a\u200bb');
  });

  it('keeps a normal link in the same message clickable', () => {
    assert.deepEqual(
      anchors('https://signal.org/abc\u200e https://signal.org/ok'),
      ['https://signal.org/ok']
    );
  });

  it('leaves links without hidden characters as they were', () => {
    assert.deepEqual(anchors('https://signal.org/abc'), [
      'https://signal.org/abc',
    ]);
    assert.deepEqual(anchors('https://signal.org/abc \u200b'), [
      'https://signal.org/abc',
    ]);
    assert.deepEqual(anchors('https://zh.wikipedia.org/wiki/中国'), [
      'https://zh.wikipedia.org/wiki/中国',
    ]);
    assert.deepEqual(anchors('https://zh.wikipedia.org/wiki/中国，很好'), [
      'https://zh.wikipedia.org/wiki/中国，很好',
    ]);
  });

  // PM 2026-10-19: same as iOS and Android
  it('ends the link at ASCII end punctuation followed by a hidden character', () => {
    for (const text of [
      'https://signal.org/abc,\u200f next',
      'https://signal.org/abc!\u2060',
      'https://signal.org/abc.\u200e',
    ]) {
      assert.deepEqual(
        anchors(text),
        ['https://signal.org/abc'],
        JSON.stringify(text)
      );
    }
    const html = renderToStaticMarkup(
      <Linkify text={'https://signal.org/abc,\u200f next'} />
    );
    assert.include(html, '</a>,\u200f next');
  });

  it('ends the link at Chinese punctuation followed by a hidden character', () => {
    const text = 'https://zh.wikipedia.org/wiki/中国，\u200b很好';
    assert.deepEqual(anchors(text), ['https://zh.wikipedia.org/wiki/中国']);
    const html = renderToStaticMarkup(<Linkify text={text} />);
    assert.include(html, '</a>，\u200b很好');
  });
});

// Message bodies are linkified by MessageTextRenderer through extractLinks.
describe('extractLinks with hidden characters (Tellomi)', () => {
  function links(text: string) {
    return extractLinks(text, text.length);
  }

  it('drops a link with a hidden character in it', () => {
    assert.deepEqual(links('https://signal.org/a\u200bb'), []);
    assert.deepEqual(links('see https://signal.org/abc\u200f next'), []);
    assert.deepEqual(links('https://signal.org/abc\u2066x'), []);
    assert.deepEqual(links('https://signal.org/a/中\u2060文'), []);
  });

  it('keeps other links in the same message', () => {
    assert.deepEqual(
      links('https://signal.org/abc\u200e https://signal.org/ok'),
      [{ start: 24, length: 21, url: 'https://signal.org/ok' }]
    );
  });

  it('leaves links without hidden characters as they were', () => {
    assert.deepEqual(links('see https://signal.org/abc'), [
      { start: 4, length: 22, url: 'https://signal.org/abc' },
    ]);
    const chinese = 'https://zh.wikipedia.org/wiki/中国，很好';
    assert.deepEqual(links(chinese), [
      { start: 0, length: chinese.length, url: chinese },
    ]);
  });

  it('ends the link at ASCII end punctuation followed by a hidden character', () => {
    const url = 'https://signal.org/abc';
    for (const after of [',\u200f next', '!\u2060', '.\u200e']) {
      assert.deepEqual(
        links(`see ${url}${after}`),
        [{ start: 4, length: url.length, url }],
        JSON.stringify(after)
      );
    }
  });

  it('ends the link at Chinese punctuation followed by a hidden character', () => {
    const url = 'https://zh.wikipedia.org/wiki/中国';
    assert.deepEqual(links(`${url}，\u200b很好`), [
      { start: 0, length: url.length, url },
    ]);
  });
});
