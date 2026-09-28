// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import i18n from '../util/i18n.node.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import { getLocalizedLinkName } from '../../linkPreviews/linkCard.std.ts';
import {
  formatLinkCardAttrs,
  getLinkPreviewDisplay,
} from '../../linkPreviews/linkPreviewDisplay.std.ts';

// ADR-0063 §5.1 / §4.8 (tellomi/tellomi#1421): what each level shows in the message bubble.

const BASE: LinkCardType = {
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

const SNAPSHOT = {
  title: 'Sender title',
  description: 'Sender description',
  domain: 'www.bilibili.com',
};

describe('getLinkPreviewDisplay', () => {
  it('shows the snapshot as Signal does when there is no decision', () => {
    assert.deepEqual(getLinkPreviewDisplay(SNAPSHOT, i18n), {
      title: 'Sender title',
      description: 'Sender description',
      domain: 'www.bilibili.com',
      officialBadge: false,
    });
  });

  it('keeps the snapshot for a generic card, with the registrable domain', () => {
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card: BASE }, i18n), {
      title: 'Sender title',
      description: 'Sender description',
      domain: 'bilibili.com',
      officialBadge: false,
    });
  });

  it('shows only the platform name on a brand shell', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'brand',
      provider: 'taobao',
      provider_name: { 'zh-Hans': '淘宝', en: 'Taobao' },
      domain: 'taobao.com',
      show_image: false,
    };
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n), {
      title: 'Taobao',
      description: undefined,
      domain: 'taobao.com',
      officialBadge: false,
    });
  });

  it('puts the attrs line in place of the description on a structured card', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'structured',
      provider: 'bilibili',
      kind: 'video',
      title: '《柯洁围棋入门课》',
      attrs: [
        { key: 'duration_ms', value: '3723000' },
        { key: 'author', value: '柯洁' },
        { key: 'published_at', value: '2026-09-01T00:00:00Z' },
      ],
    };
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n), {
      title: '《柯洁围棋入门课》',
      description: '柯洁 · 1:02:03',
      domain: 'bilibili.com',
      officialBadge: false,
    });
  });

  it('shows fixed text, the path and the badge on the official site card', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'first_party',
      provider: 'tellomi',
      kind: 'tellomi.official',
      domain: 'tellomi.app',
      official_badge: true,
      first_party: { type: 'official', path: '/download' },
      show_image: false,
    };
    assert.deepEqual(
      getLinkPreviewDisplay(
        { ...SNAPSHOT, title: 'Account locked, reply with your code', card },
        i18n
      ),
      {
        title: 'Tellomi website',
        description: '/download',
        domain: 'tellomi.app',
        officialBadge: true,
      }
    );
  });

  it('names a user from the URL, never from the sender', () => {
    const user = (display: string | null): LinkCardType => ({
      ...BASE,
      level: 'first_party',
      provider: 'tellomi',
      kind: 'tellomi.user',
      domain: 'tell.cc',
      first_party: {
        type: 'user',
        display,
        username: display ? 'kefu.57' : null,
      },
      show_image: false,
    });
    assert.deepEqual(
      getLinkPreviewDisplay(
        { ...SNAPSHOT, title: '@kefu', card: user('@kefu.57') },
        i18n
      ),
      {
        title: '@kefu.57',
        description: 'Tellomi user',
        domain: 'tell.cc',
        officialBadge: false,
      }
    );
    assert.deepEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card: user(null) }, i18n),
      {
        title: 'Tellomi user',
        description: undefined,
        domain: 'tell.cc',
        officialBadge: false,
      }
    );
  });
});

describe('formatLinkCardAttrs', () => {
  it('returns nothing when no attr is shown as text', () => {
    assert.isUndefined(
      formatLinkCardAttrs({
        ...BASE,
        attrs: [{ key: 'member_count', value: '12' }],
      })
    );
  });

  it('formats short durations as m:ss', () => {
    assert.strictEqual(
      formatLinkCardAttrs({
        ...BASE,
        attrs: [{ key: 'duration_ms', value: '65000' }],
      }),
      '1:05'
    );
  });
});

describe('getLocalizedLinkName', () => {
  const name = {
    'zh-Hans': '网易云音乐',
    'zh-Hant': '網易雲音樂',
    en: 'NetEase',
  };

  it('picks the script for the locale', () => {
    assert.strictEqual(getLocalizedLinkName(name, 'zh-CN'), '网易云音乐');
    assert.strictEqual(getLocalizedLinkName(name, 'zh-HK'), '網易雲音樂');
    assert.strictEqual(getLocalizedLinkName(name, 'zh-Hant'), '網易雲音樂');
    assert.strictEqual(getLocalizedLinkName(name, 'en'), 'NetEase');
  });

  it('falls back to simplified Chinese when there is no traditional name', () => {
    assert.strictEqual(
      getLocalizedLinkName({ 'zh-Hans': '淘宝', en: 'Taobao' }, 'zh-HK'),
      '淘宝'
    );
  });
});
