// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import {
  getLinkOnlyUrl,
  isLinkCardOnly,
  toPlainLinkCard,
} from '../../linkPreviews/linkOnlyMessage.std.ts';

// card-visual §3.5 (tellomi/tellomi#1421): a message that is nothing but one link shows the card
// alone; with no preview, or a plain-link decision, a no-image card drawn from the URL.

const CARD: LinkCardType = {
  level: 'generic',
  provider: null,
  provider_name: null,
  kind: null,
  route: null,
  title: 'Sender title',
  description: null,
  attrs: [],
  domain: 'bilibili.com',
  official_badge: false,
  first_party: null,
  lookalike: null,
  show_image: true,
  tintable: true,
  payment: false,
  reason: null,
};

const URL = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';

describe('getLinkOnlyUrl', () => {
  it('returns the link when it is the whole body, ignoring surrounding white space', () => {
    assert.strictEqual(getLinkOnlyUrl(URL, false), URL);
    assert.strictEqual(getLinkOnlyUrl(`  ${URL}\n`, false), URL);
    assert.strictEqual(
      getLinkOnlyUrl('http://www.163.com/news/article/K1234.html', false),
      'http://www.163.com/news/article/K1234.html'
    );
  });

  it('is undefined when there is any other text', () => {
    assert.isUndefined(getLinkOnlyUrl(`看看这个 ${URL}`, false));
    assert.isUndefined(getLinkOnlyUrl(`${URL} 看看`, false));
    assert.isUndefined(getLinkOnlyUrl(`${URL}\n${URL}`, false));
    assert.isUndefined(
      getLinkOnlyUrl(
        `${URL} https://www.163.com/news/article/K1234.html`,
        false
      )
    );
  });

  it('is undefined when the body shows the link shorter than the text', () => {
    // Trailing punctuation is not part of the link in the body.
    assert.isUndefined(getLinkOnlyUrl('https://www.163.com/a.', false));
    assert.isUndefined(getLinkOnlyUrl('https://www.163.com/a b', false));
  });

  it('does not care how the scheme is written', () => {
    assert.strictEqual(
      getLinkOnlyUrl('HTTPS://WWW.BILIBILI.COM/video/BV1YDhJ6ZEL6', false),
      'HTTPS://WWW.BILIBILI.COM/video/BV1YDhJ6ZEL6'
    );
  });

  it('only takes http and https links written out in full', () => {
    assert.isUndefined(getLinkOnlyUrl('tell.cc/kaixin', false));
    assert.isUndefined(getLinkOnlyUrl('www.bilibili.com', false));
    assert.isUndefined(getLinkOnlyUrl('ftp://example.org/file', false));
    assert.isUndefined(getLinkOnlyUrl('data:text/html,hello', false));
    assert.isUndefined(getLinkOnlyUrl('mailto:someone@example.org', false));
    assert.isUndefined(getLinkOnlyUrl('sgnl://signal.group/#abc', false));
  });

  it('is undefined for a body Signal does not linkify', () => {
    assert.isUndefined(getLinkOnlyUrl(`‮${URL}`, false));
  });

  it('is undefined when the message has anything but plain text', () => {
    assert.isUndefined(getLinkOnlyUrl(URL, true));
  });

  it('is undefined without a body', () => {
    assert.isUndefined(getLinkOnlyUrl(undefined, false));
    assert.isUndefined(getLinkOnlyUrl('', false));
    assert.isUndefined(getLinkOnlyUrl('   ', false));
  });
});

describe('isLinkCardOnly', () => {
  it('is true for the one preview of the link the body consists of', () => {
    assert.isTrue(isLinkCardOnly(URL, [{ url: URL, card: CARD }]));
  });

  it('keeps Signal’s layout without a decision from rust/links', () => {
    assert.isFalse(isLinkCardOnly(URL, [{ url: URL }]));
  });

  it('keeps the text when the preview is of another link', () => {
    assert.isFalse(isLinkCardOnly(URL, [{ url: `${URL}/`, card: CARD }]));
  });

  it('keeps the text unless there is exactly one preview', () => {
    assert.isFalse(isLinkCardOnly(URL, []));
    assert.isFalse(
      isLinkCardOnly(URL, [
        { url: URL, card: CARD },
        { url: URL, card: CARD },
      ])
    );
  });

  it('keeps the text when the body is not one link', () => {
    assert.isFalse(isLinkCardOnly(undefined, [{ url: URL, card: CARD }]));
  });
});

describe('toPlainLinkCard', () => {
  it('keeps only the domain and the lookalike warning', () => {
    const card: LinkCardType = {
      ...CARD,
      level: 'first_party',
      provider: 'tellomi',
      provider_name: { 'zh-Hans': '官网', en: 'Website' },
      kind: 'tellomi.official',
      route: 'official',
      title: 'Title',
      description: 'Description',
      attrs: [{ key: 'author', value: 'Someone' }],
      domain: 'tellomi.app',
      official_badge: true,
      first_party: { type: 'official', path: '/download' },
      lookalike: 'tellomi.app',
      show_image: true,
      tintable: true,
    };
    assert.deepEqual(toPlainLinkCard(card), {
      ...card,
      level: 'plain_link',
      provider: null,
      provider_name: null,
      kind: null,
      route: null,
      title: null,
      description: null,
      attrs: [],
      official_badge: false,
      first_party: null,
      show_image: false,
      tintable: false,
    });
  });

  it('takes a lookalike warning found elsewhere when the card has none', () => {
    assert.strictEqual(
      toPlainLinkCard({ ...CARD, domain: 'bi1ibili.com' }, 'bilibili.com')
        .lookalike,
      'bilibili.com'
    );
    assert.strictEqual(
      toPlainLinkCard({ ...CARD, lookalike: 'apple.com' }, undefined).lookalike,
      'apple.com'
    );
  });
});
