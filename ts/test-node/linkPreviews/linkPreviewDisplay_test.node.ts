// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import i18n from '../util/i18n.node.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import { getLocalizedLinkName } from '../../linkPreviews/linkCard.std.ts';
import {
  formatDurationMs,
  formatLinkCardDate,
  getLinkPreviewDisplay,
} from '../../linkPreviews/linkPreviewDisplay.std.ts';

// ADR-0063 §5.1 / §4.8 (tellomi/tellomi#1421): what each level shows in the message bubble, per
// the finalized card spec (card-visual §3.7 / §3.9 / §3.10, 2026-09-29): title, one sub line,
// domain line; the sender's description never shows.

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

// Noon UTC stays on the same calendar day in any time zone from UTC-11 to UTC+11.
const NOW = Date.UTC(2026, 8, 29, 12);

function structured(
  kind: string,
  attrs: Record<string, string>,
  title: string | null = 'Title'
): LinkCardType {
  return {
    ...BASE,
    level: 'structured',
    kind,
    title,
    attrs: Object.entries(attrs).map(([key, value]) => ({ key, value })),
  };
}

function subLine(card: LinkCardType): string | undefined {
  return getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n, NOW).description;
}

describe('getLinkPreviewDisplay', () => {
  it('shows the snapshot as Signal does when there is no decision', () => {
    assert.deepEqual(getLinkPreviewDisplay(SNAPSHOT, i18n, NOW), {
      title: 'Sender title',
      description: 'Sender description',
      domain: 'www.bilibili.com',
      officialBadge: false,
      hideSnapshotDate: false,
    });
  });

  it('shows the registrable domain once, as the title, on a plain-link card', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'plain_link',
      title: null,
      show_image: false,
      tintable: false,
      reason: 'no_title',
    };
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n, NOW), {
      title: 'bilibili.com',
      description: undefined,
      domain: undefined,
      officialBadge: false,
      hideSnapshotDate: true,
    });
  });

  it('shows the snapshot title and the registrable domain on a generic card, never the description', () => {
    assert.deepEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card: BASE }, i18n, NOW),
      {
        title: 'Sender title',
        description: undefined,
        domain: 'bilibili.com',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
    assert.isUndefined(
      getLinkPreviewDisplay(
        { ...SNAPSHOT, title: undefined, card: BASE },
        i18n,
        NOW
      ).title
    );
  });

  it('shows the platform name and what the link is on a brand shell', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'brand',
      provider: 'taobao',
      provider_name: { 'zh-Hans': '淘宝', en: 'Taobao' },
      kind: 'product',
      domain: 'taobao.com',
      show_image: false,
    };
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n, NOW), {
      title: 'Taobao',
      description: 'Product',
      domain: 'taobao.com',
      officialBadge: false,
      hideSnapshotDate: true,
    });
    assert.strictEqual(subLine({ ...card, kind: 'web' }), 'Web page');
    assert.isUndefined(subLine({ ...card, kind: null }));
    assert.isUndefined(
      subLine({ ...card, kind: 'podcast' }),
      'no English kind id when the table has no name for it'
    );
  });

  it('names every kind of the table on a brand shell', () => {
    const names = {
      video: 'Video',
      channel: 'Channel',
      'music.track': 'Song',
      'music.album': 'Album',
      'music.playlist': 'Playlist',
      place: 'Place',
      app: 'App',
      repo: 'Repository',
      article: 'Article',
      product: 'Product',
      package: 'Package',
      question: 'Q&A',
      deal: 'Deal',
      ride: 'Ride',
      payment: 'Payment',
      web: 'Web page',
    };
    for (const [kind, name] of Object.entries(names)) {
      assert.strictEqual(
        subLine({
          ...BASE,
          level: 'brand',
          provider_name: { 'zh-Hans': '平台', en: 'Platform' },
          kind,
        }),
        name,
        kind
      );
    }
  });

  it('shows author and duration on a video, and the publish date after the domain', () => {
    const card = structured(
      'video',
      {
        duration_ms: '3723000',
        author: '柯洁',
        published_at: '2026-09-01T08:00:00+08:00',
      },
      '《柯洁围棋入门课》'
    );
    // card-visual §3.7: the sub line's parts are joined by U+00B7, the domain line's domain and
    // date by U+22C5 (a different dot, on purpose).
    assert.deepEqual(getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n, NOW), {
      title: '《柯洁围棋入门课》',
      description: '柯洁 \u00B7 1:02:03',
      domain: 'bilibili.com \u22C5 Sep 1',
      officialBadge: false,
      hideSnapshotDate: true,
    });
    assert.strictEqual(
      getLinkPreviewDisplay(
        {
          ...SNAPSHOT,
          card: structured('video', { published_at: 'not a date' }),
        },
        i18n,
        NOW
      ).domain,
      'bilibili.com'
    );
  });

  it('gives each structured kind its own sub line', () => {
    assert.strictEqual(subLine(structured('channel', { author: 'Up' })), 'Up');
    assert.strictEqual(
      subLine(
        structured('music.track', {
          album: 'Album',
          duration_ms: '225000',
          artist: 'Artist',
        })
      ),
      'Artist · Album · 3:45'
    );
    assert.strictEqual(
      subLine(
        structured('music.album', { track_count: '12', artist: 'Artist' })
      ),
      'Artist · 12 tracks'
    );
    assert.strictEqual(
      subLine(structured('music.album', { track_count: '1' })),
      '1 track'
    );
    assert.strictEqual(
      subLine(
        structured('music.playlist', { author: 'Curator', track_count: '30' })
      ),
      'Curator · 30 tracks'
    );
    assert.strictEqual(
      subLine(structured('app', { platform: 'ios', developer: 'Developer' })),
      'Developer · iOS'
    );
    assert.strictEqual(
      subLine(structured('app', { platform: 'android' })),
      'Android'
    );
    assert.strictEqual(
      subLine(structured('repo', { owner: 'tellomi' })),
      'tellomi'
    );
    assert.isUndefined(
      subLine(structured('video', { published_at: '2026-09-01T00:00:00Z' })),
      "a video's date is on the domain line, not the sub line"
    );
  });

  it('skips missing and invalid values on the sub line', () => {
    assert.strictEqual(
      subLine(structured('video', { duration_ms: '65000' })),
      '1:05'
    );
    assert.isUndefined(subLine(structured('video', { duration_ms: '0' })));
    assert.isUndefined(
      subLine(structured('music.album', { track_count: '0' }))
    );
    assert.isUndefined(
      subLine(structured('music.album', { track_count: 'many' }))
    );
    assert.isUndefined(
      subLine(structured('repo', { author: 'Someone' })),
      'attrs of other kinds are not shown'
    );
  });

  it('titles a place by its name and never shows coordinates', () => {
    const place = structured(
      'place',
      { lat: '31.2', lng: '121.4', coord_sys: 'gcj02' },
      null
    );
    assert.deepEqual(
      getLinkPreviewDisplay(
        { ...SNAPSHOT, title: undefined, card: place },
        i18n,
        NOW
      ),
      {
        title: 'Location',
        description: undefined,
        domain: 'bilibili.com',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
    assert.strictEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card: place }, i18n, NOW).title,
      'Sender title'
    );
    const named = structured('place', {
      name: '外滩',
      address: '上海市黄浦区中山东一路',
    });
    assert.deepEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card: named }, i18n, NOW),
      {
        title: '外滩',
        description: '上海市黄浦区中山东一路',
        domain: 'bilibili.com',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
  });

  it('shows a structured kind this build does not know like generic', () => {
    assert.deepEqual(
      getLinkPreviewDisplay(
        {
          ...SNAPSHOT,
          card: structured('podcast', { author: 'Host' }, 'Episode 1'),
        },
        i18n,
        NOW
      ),
      {
        title: 'Episode 1',
        description: undefined,
        domain: 'bilibili.com',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
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
        i18n,
        NOW
      ),
      {
        title: 'Tellomi website',
        description: '/download',
        domain: 'tellomi.app',
        officialBadge: true,
        hideSnapshotDate: true,
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
        i18n,
        NOW
      ),
      {
        title: '@kefu.57',
        description: 'Tellomi user',
        domain: 'tell.cc',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
    assert.deepEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card: user(null) }, i18n, NOW),
      {
        title: 'Tellomi user',
        description: undefined,
        domain: 'tell.cc',
        officialBadge: false,
        hideSnapshotDate: true,
      }
    );
  });
});

describe('formatDurationMs', () => {
  it('rounds to seconds, m:ss under an hour and h:mm:ss from an hour', () => {
    assert.strictEqual(formatDurationMs('500'), '0:01');
    assert.strictEqual(formatDurationMs('1499'), '0:01');
    assert.strictEqual(formatDurationMs('1500'), '0:02');
    assert.strictEqual(formatDurationMs('225000'), '3:45');
    assert.strictEqual(formatDurationMs('3727000'), '1:02:07');
  });

  it('shows nothing when the duration rounds to zero seconds (1 to 499 ms)', () => {
    assert.isUndefined(formatDurationMs('1'));
    assert.isUndefined(formatDurationMs('499'));
    assert.strictEqual(
      formatDurationMs('500'),
      '0:01',
      'the next one up shows'
    );
  });

  it('shows nothing for zero, negative or not a number', () => {
    assert.isUndefined(formatDurationMs('0'));
    assert.isUndefined(formatDurationMs('-5'));
    assert.isUndefined(formatDurationMs('-499'));
    assert.isUndefined(formatDurationMs('long'));
    assert.isUndefined(formatDurationMs('NaN'));
    assert.isUndefined(formatDurationMs('Infinity'));
    assert.isUndefined(formatDurationMs('1.5'));
    assert.isUndefined(formatDurationMs('9007199254740993'));
    assert.isUndefined(formatDurationMs(''));
    assert.isUndefined(formatDurationMs(undefined));
  });

  it('leaves the duration off a video whose duration rounds to zero', () => {
    const card: LinkCardType = {
      ...BASE,
      level: 'structured',
      kind: 'video',
      title: 'Title',
      attrs: [
        { key: 'author', value: 'Up' },
        { key: 'duration_ms', value: '499' },
      ],
    };
    assert.strictEqual(
      getLinkPreviewDisplay({ ...SNAPSHOT, card }, i18n, NOW).description,
      'Up'
    );
  });
});

describe('formatLinkCardDate', () => {
  it('drops the year when it is this year', () => {
    assert.strictEqual(
      formatLinkCardDate(Date.UTC(2026, 8, 3, 12), 'en', NOW),
      'Sep 3'
    );
    assert.strictEqual(
      formatLinkCardDate(Date.UTC(2025, 11, 1, 12), 'en', NOW),
      'Dec 1, 2025'
    );
    assert.strictEqual(
      formatLinkCardDate(Date.UTC(2026, 8, 3, 12), 'zh-CN', NOW),
      '9月3日'
    );
    assert.strictEqual(
      formatLinkCardDate(Date.UTC(2025, 11, 1, 12), 'zh-CN', NOW),
      '2025年12月1日'
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
