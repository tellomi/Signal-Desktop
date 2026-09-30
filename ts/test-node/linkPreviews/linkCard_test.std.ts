// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { parseLinkCard } from '../../linkPreviews/linkCard.std.ts';

// The shape of `rust/links` `Card`, with the `icon` of a brand shell (ADR-0063 §九.6).

const BRAND = {
  level: 'brand',
  provider: 'taobao',
  provider_name: { 'zh-Hans': '淘宝', en: 'Taobao' },
  kind: 'product',
  route: 'item',
  title: null,
  description: null,
  attrs: [],
  domain: 'taobao.com',
  official_badge: false,
  first_party: null,
  lookalike: null,
  show_image: false,
  icon: 'taobao.png',
  tintable: true,
  payment: false,
  reason: null,
};

function parse(overrides: Record<string, unknown>) {
  const card = { ...BRAND, ...overrides };
  return parseLinkCard(JSON.stringify(card));
}

describe('parseLinkCard icon', () => {
  it('keeps the name of a bundled icon file', () => {
    assert.strictEqual(parse({})?.icon, 'taobao.png');
    assert.strictEqual(parse({ icon: 'weixin-mp.png' })?.icon, 'weixin-mp.png');
  });

  it('reads null as no icon', () => {
    assert.isNull(parse({ icon: null })?.icon);
  });

  it('reads a card from a bridge that predates the field as no icon', () => {
    const withoutIcon: Record<string, unknown> = { ...BRAND };
    delete withoutIcon.icon;
    const card = parseLinkCard(JSON.stringify(withoutIcon));
    assert.isDefined(card);
    assert.isUndefined(card?.icon);
    assert.strictEqual(card?.provider, 'taobao');
  });

  it('turns anything that is not an icon file name into no icon, and keeps the card', () => {
    for (const icon of [
      '../x.png',
      'a/b.png',
      'Taobao.png',
      'taobao.jpg',
      '',
      7,
      true,
      ['taobao.png'],
      { name: 'taobao.png' },
    ]) {
      const card = parse({ icon });
      assert.isDefined(card, JSON.stringify(icon));
      assert.isNull(card?.icon, JSON.stringify(icon));
      assert.strictEqual(card?.level, 'brand');
      assert.strictEqual(card?.provider, 'taobao');
    }
  });
});
