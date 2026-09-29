// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  getLinkCardTintColors,
  parseLinkCardLayout,
  parseLinkCardTint,
  shouldTintLinkCard,
} from '../../linkPreviews/linkCardVisual.std.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';

// card-visual §3.2 / §3.3 / §3.8: the shape of a card and the colours from its own image come from
// rust/links (`layout` / `tint`); the client only reads the answer and applies it.

const CARD: LinkCardType = {
  level: 'generic',
  provider: null,
  provider_name: null,
  kind: null,
  route: null,
  title: null,
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

// The tint the bridge returned for `rust/links/tests/data/bridge-golden.json`'s orange icon.
const ORANGE =
  '{"tinted":true,"source":"#FE7500","light":{"background":"#FE7500","text":"#000000"},"dark":{"background":"#994600","text":"#FFFFFF"}}';

describe('parseLinkCardLayout', () => {
  it('reads the four shapes', () => {
    for (const name of ['first_party', 'large_image', 'icon', 'no_image']) {
      assert.strictEqual(parseLinkCardLayout(name), name);
    }
  });

  it('is undefined for anything else, so the card keeps its default look', () => {
    assert.isUndefined(parseLinkCardLayout('hologram'));
    assert.isUndefined(parseLinkCardLayout(''));
    assert.isUndefined(parseLinkCardLayout('"icon"'));
  });
});

describe('parseLinkCardTint', () => {
  it('reads a tinted result', () => {
    assert.deepEqual(parseLinkCardTint(ORANGE), {
      tinted: true,
      light: { background: '#FE7500', text: '#000000' },
      dark: { background: '#994600', text: '#FFFFFF' },
    });
  });

  it('reads a neutral result: the default card colours stay', () => {
    assert.deepEqual(parseLinkCardTint('{"tinted":false,"source":"#808082"}'), {
      tinted: false,
    });
  });

  it('is undefined for anything it does not understand', () => {
    assert.isUndefined(parseLinkCardTint('not json'));
    assert.isUndefined(parseLinkCardTint('{}'));
    assert.isUndefined(parseLinkCardTint('{"tinted":true}'));
    assert.isUndefined(
      parseLinkCardTint(
        '{"tinted":true,"light":{"background":"red","text":"#000000"},"dark":{"background":"#994600","text":"#FFFFFF"}}'
      ),
      'a colour that is not #RRGGBB is not applied'
    );
  });
});

describe('getLinkCardTintColors', () => {
  const tint = parseLinkCardTint(ORANGE);

  it('picks the light or the dark set by theme', () => {
    assert.deepEqual(getLinkCardTintColors(tint, 'light'), {
      background: '#FE7500',
      text: '#000000',
    });
    assert.deepEqual(getLinkCardTintColors(tint, 'dark'), {
      background: '#994600',
      text: '#FFFFFF',
    });
  });

  it('has nothing to apply for a neutral image or no result', () => {
    assert.isUndefined(getLinkCardTintColors({ tinted: false }, 'light'));
    assert.isUndefined(getLinkCardTintColors(undefined, 'dark'));
  });
});

describe('shouldTintLinkCard', () => {
  it('tints third-party cards with an image', () => {
    assert.isTrue(
      shouldTintLinkCard({
        card: CARD,
        layout: 'icon',
        isMessageRequest: false,
      })
    );
    assert.isTrue(
      shouldTintLinkCard({
        card: CARD,
        layout: 'large_image',
        isMessageRequest: false,
      })
    );
  });

  it('never tints a card in a message request, whatever rust/links says', () => {
    assert.isFalse(
      shouldTintLinkCard({ card: CARD, layout: 'icon', isMessageRequest: true })
    );
  });

  it('never tints first-party, payment or plain cards, or one without an image', () => {
    assert.isFalse(
      shouldTintLinkCard({
        card: { ...CARD, tintable: false },
        layout: 'icon',
        isMessageRequest: false,
      })
    );
    assert.isFalse(
      shouldTintLinkCard({
        card: CARD,
        layout: 'first_party',
        isMessageRequest: false,
      })
    );
    assert.isFalse(
      shouldTintLinkCard({
        card: CARD,
        layout: 'no_image',
        isMessageRequest: false,
      })
    );
    assert.isFalse(
      shouldTintLinkCard({
        card: CARD,
        layout: undefined,
        isMessageRequest: false,
      })
    );
    assert.isFalse(
      shouldTintLinkCard({
        card: undefined,
        layout: 'icon',
        isMessageRequest: false,
      })
    );
  });
});
