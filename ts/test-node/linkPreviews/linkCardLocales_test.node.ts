// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import { getFirstPartyCardDisplay } from '../../linkPreviews/firstPartyCard.std.ts';
import {
  formatLinkCardDate,
  getLinkPreviewDisplay,
} from '../../linkPreviews/linkPreviewDisplay.std.ts';
import type { LocalizerType } from '../../types/Util.std.ts';
import type { CardLocaleType } from '../util/localeI18n.node.ts';
import {
  CARD_LOCALES,
  getLocaleI18n,
  readLocaleMessages,
} from '../util/localeI18n.node.ts';

// card-visual §3.9 (formats), §3.10 (the kind names and the first-party buttons) and §3.11 ("类型文字
// 与按钮：§3.10 两张表四种语言各端单测对一遍"), audit H3 and G1–G6. The tables below are copied from
// the document, word for word, and every test reads `_locales/<language>/messages.json` or the
// localizer the app builds from it, with real ICU: the English strings were tested before, the
// other three languages were only checked by hand.
//
// The document has one traditional-Chinese column and two exceptions in brackets: `music.playlist`
// is 歌單 in Hong Kong and 播放清單 in Taiwan, `app` is 應用程式 in Hong Kong and App in Taiwan.
// `zh-HK` is the Hong Kong column and `zh-Hant` the Taiwan one.

type ByLocale = Readonly<Record<CardLocaleType, string>>;

const KIND_NAMES: Readonly<Record<string, ByLocale>> = {
  video: { en: 'Video', 'zh-CN': '视频', 'zh-HK': '影片', 'zh-Hant': '影片' },
  channel: {
    en: 'Channel',
    'zh-CN': '频道',
    'zh-HK': '頻道',
    'zh-Hant': '頻道',
  },
  'music.track': {
    en: 'Song',
    'zh-CN': '单曲',
    'zh-HK': '單曲',
    'zh-Hant': '單曲',
  },
  'music.album': {
    en: 'Album',
    'zh-CN': '专辑',
    'zh-HK': '專輯',
    'zh-Hant': '專輯',
  },
  'music.playlist': {
    en: 'Playlist',
    'zh-CN': '歌单',
    'zh-HK': '歌單',
    'zh-Hant': '播放清單',
  },
  place: { en: 'Place', 'zh-CN': '地点', 'zh-HK': '地點', 'zh-Hant': '地點' },
  app: { en: 'App', 'zh-CN': '应用', 'zh-HK': '應用程式', 'zh-Hant': 'App' },
  repo: {
    en: 'Repository',
    'zh-CN': '代码仓库',
    'zh-HK': '程式碼倉庫',
    'zh-Hant': '程式碼倉庫',
  },
  article: {
    en: 'Article',
    'zh-CN': '文章',
    'zh-HK': '文章',
    'zh-Hant': '文章',
  },
  product: {
    en: 'Product',
    'zh-CN': '商品',
    'zh-HK': '商品',
    'zh-Hant': '商品',
  },
  package: {
    en: 'Package',
    'zh-CN': '快递',
    'zh-HK': '包裹',
    'zh-Hant': '包裹',
  },
  question: {
    en: 'Q&A',
    'zh-CN': '问答',
    'zh-HK': '問答',
    'zh-Hant': '問答',
  },
  deal: { en: 'Deal', 'zh-CN': '团购', 'zh-HK': '團購', 'zh-Hant': '團購' },
  ride: { en: 'Ride', 'zh-CN': '行程', 'zh-HK': '行程', 'zh-Hant': '行程' },
  payment: {
    en: 'Payment',
    'zh-CN': '支付',
    'zh-HK': '付款',
    'zh-Hant': '付款',
  },
  web: {
    en: 'Web page',
    'zh-CN': '网页',
    'zh-HK': '網頁',
    'zh-Hant': '網頁',
  },
};

// The button of a first-party card (§5.2 "按钮" column) by the key of its string.
const BUTTONS: Readonly<Record<string, ByLocale>> = {
  action_message: {
    en: 'Message',
    'zh-CN': '发消息',
    'zh-HK': '傳送訊息',
    'zh-Hant': '傳送訊息',
  },
  action_join_group: {
    en: 'Join Group',
    'zh-CN': '加入群聊',
    'zh-HK': '加入群組',
    'zh-Hant': '加入群組',
  },
  action_open: {
    en: 'Open',
    'zh-CN': '打开',
    'zh-HK': '開啟',
    'zh-Hant': '開啟',
  },
  action_join_call: {
    en: 'Join Call',
    'zh-CN': '加入通话',
    'zh-HK': '加入通話',
    'zh-Hant': '加入通話',
  },
  action_add_stickers: {
    en: 'Add',
    'zh-CN': '添加',
    'zh-HK': '新增',
    'zh-Hant': '新增',
  },
  action_view_stickers: {
    en: 'View',
    'zh-CN': '查看',
    'zh-HK': '查看',
    'zh-Hant': '查看',
  },
};

const KEY_PREFIX = 'icu:TellomiLinkCard__';

function messagesWithPrefix(
  locale: string,
  prefix: string
): Record<string, string | undefined> {
  const messages = readLocaleMessages(locale);
  return Object.fromEntries(
    Object.entries(messages)
      .filter(([key]) => key.startsWith(`${KEY_PREFIX}${prefix}`))
      .map(([key, value]) => [
        key.slice(KEY_PREFIX.length),
        (value as { messageformat?: string }).messageformat,
      ])
  );
}

const BASE: LinkCardType = {
  level: 'brand',
  provider: 'netease-music',
  provider_name: { 'zh-Hans': '网易云音乐', en: 'NetEase Music' },
  kind: null,
  route: null,
  title: null,
  description: null,
  attrs: [],
  domain: 'music.163.com',
  official_badge: false,
  first_party: null,
  lookalike: null,
  show_image: false,
  tintable: true,
  payment: false,
  reason: null,
};

function brandCard(kind: string): LinkCardType {
  return { ...BASE, kind };
}

function structured(kind: string, attrs: Record<string, string>): LinkCardType {
  return {
    ...BASE,
    level: 'structured',
    kind,
    title: 'Title',
    attrs: Object.entries(attrs).map(([key, value]) => ({ key, value })),
  };
}

function firstParty(
  shape: NonNullable<LinkCardType['first_party']>
): LinkCardType {
  return {
    ...BASE,
    level: 'first_party',
    provider: 'tellomi',
    provider_name: null,
    domain: 'tell.cc',
    first_party: shape,
    show_image: false,
    tintable: false,
  };
}

// Noon UTC stays on the same calendar day in any time zone from UTC-11 to UTC+11.
const NOW = Date.UTC(2026, 8, 29, 12);

describe('the link card texts in the four languages', () => {
  const i18nByLocale = new Map<CardLocaleType, LocalizerType>();

  before(() => {
    for (const locale of CARD_LOCALES) {
      i18nByLocale.set(locale, getLocaleI18n(locale));
    }
  });

  function i18nFor(locale: CardLocaleType): LocalizerType {
    const found = i18nByLocale.get(locale);
    if (!found) {
      throw new Error(`no localizer for ${locale}`);
    }
    return found;
  }

  function subLine(card: LinkCardType, locale: CardLocaleType): string {
    const { description } = getLinkPreviewDisplay(
      { title: 'Sender title', description: 'Sender description', card },
      i18nFor(locale),
      NOW
    );
    return description ?? '';
  }

  for (const locale of CARD_LOCALES) {
    describe(`in ${locale}`, () => {
      describe('§3.10 kind names (brand shell sub line)', () => {
        it('the file has these 16 and no other', () => {
          const expected = Object.fromEntries(
            Object.entries(KIND_NAMES).map(([kind, names]) => [
              `kind_${kind.replace('.', '_')}`,
              names[locale],
            ])
          );
          assert.lengthOf(Object.keys(expected), 16);
          assert.deepEqual(messagesWithPrefix(locale, 'kind_'), expected);
        });

        for (const [kind, names] of Object.entries(KIND_NAMES)) {
          it(`${kind} is ${names[locale]}, and a brand shell shows it`, () => {
            assert.strictEqual(subLine(brandCard(kind), locale), names[locale]);
          });
        }

        it('a kind the table does not have leaves the sub line empty, not its id', () => {
          assert.strictEqual(subLine(brandCard('hologram'), locale), '');
        });
      });

      describe('§3.10 buttons of a first-party card', () => {
        it('the file has these 6 and no other', () => {
          const expected = Object.fromEntries(
            Object.entries(BUTTONS).map(([key, names]) => [key, names[locale]])
          );
          assert.lengthOf(Object.keys(expected), 6);
          assert.deepEqual(messagesWithPrefix(locale, 'action_'), expected);
        });

        it('each object has the button the table names', () => {
          const i18n = i18nFor(locale);
          const action = (
            shape: NonNullable<LinkCardType['first_party']>,
            local?: Parameters<typeof getFirstPartyCardDisplay>[1]
          ): string | undefined =>
            getFirstPartyCardDisplay(firstParty(shape), local, i18n)?.action;

          const user = { type: 'user', display: null, username: null } as const;
          const group = {
            type: 'group',
            title: 'Group',
            member_count: 12,
          } as const;
          const sticker = {
            type: 'sticker',
            title: 'Pack',
            sticker_count: 24,
          } as const;

          assert.strictEqual(
            action(user),
            BUTTONS.action_message?.[locale],
            'user'
          );
          assert.strictEqual(
            action(group),
            BUTTONS.action_join_group?.[locale],
            'group, not joined'
          );
          assert.strictEqual(
            action(group, { isGroupMember: true }),
            BUTTONS.action_open?.[locale],
            'group, joined'
          );
          assert.strictEqual(
            action({ type: 'call', title: null }),
            BUTTONS.action_join_call?.[locale],
            'call'
          );
          assert.strictEqual(
            action(sticker),
            BUTTONS.action_add_stickers?.[locale],
            'sticker pack, not added'
          );
          assert.strictEqual(
            action(sticker, { isStickerPackInstalled: true }),
            BUTTONS.action_view_stickers?.[locale],
            'sticker pack, added'
          );
          assert.strictEqual(
            action({ type: 'official', path: '/download' }),
            BUTTONS.action_open?.[locale],
            'official site'
          );
        });
      });
    });
  }

  // §3.9 counts: one plural form per language as the document writes it, the number as it is
  // written in that language, "thousands separator and nothing more" (no 1.2万, no 1.2K).
  const COUNTS: Readonly<
    Record<
      'members' | 'stickers' | 'tracks',
      Readonly<Record<CardLocaleType, ReadonlyArray<[number, string]>>>
    >
  > = {
    members: {
      en: [
        [1, '1 member'],
        [12, '12 members'],
        [128, '128 members'],
        [12345, '12,345 members'],
      ],
      'zh-CN': [
        [1, '1 位成员'],
        [12, '12 位成员'],
        [128, '128 位成员'],
        [12345, '12,345 位成员'],
      ],
      'zh-HK': [
        [1, '1 個成員'],
        [12, '12 個成員'],
        [128, '128 個成員'],
        [12345, '12,345 個成員'],
      ],
      'zh-Hant': [
        [1, '1 個成員'],
        [12, '12 個成員'],
        [128, '128 個成員'],
        [12345, '12,345 個成員'],
      ],
    },
    stickers: {
      en: [
        [1, '1 sticker'],
        [24, '24 stickers'],
        [12345, '12,345 stickers'],
      ],
      'zh-CN': [
        [1, '1 个贴纸'],
        [24, '24 个贴纸'],
        [12345, '12,345 个贴纸'],
      ],
      'zh-HK': [
        [1, '1 個貼圖'],
        [24, '24 個貼圖'],
        [12345, '12,345 個貼圖'],
      ],
      'zh-Hant': [
        [1, '1 個貼圖'],
        [24, '24 個貼圖'],
        [12345, '12,345 個貼圖'],
      ],
    },
    tracks: {
      en: [
        [1, '1 track'],
        [12, '12 tracks'],
        [12345, '12,345 tracks'],
      ],
      'zh-CN': [
        [1, '1 首'],
        [12, '12 首'],
        [12345, '12,345 首'],
      ],
      'zh-HK': [
        [1, '1 首'],
        [12, '12 首'],
        [12345, '12,345 首'],
      ],
      'zh-Hant': [
        [1, '1 首'],
        [12, '12 首'],
        [12345, '12,345 首'],
      ],
    },
  };

  describe('§3.9 member count of a group card', () => {
    for (const locale of CARD_LOCALES) {
      it(`in ${locale}`, () => {
        for (const [count, text] of COUNTS.members[locale]) {
          const display = getFirstPartyCardDisplay(
            firstParty({ type: 'group', title: 'Group', member_count: count }),
            undefined,
            i18nFor(locale)
          );
          assert.strictEqual(display?.subtitle, text, String(count));
        }
      });
    }

    it('shows no count for zero, a negative number or none, in any language', () => {
      for (const locale of CARD_LOCALES) {
        for (const count of [0, -3, null]) {
          const display = getFirstPartyCardDisplay(
            firstParty({ type: 'group', title: 'Group', member_count: count }),
            undefined,
            i18nFor(locale)
          );
          assert.isUndefined(display?.subtitle, `${locale} ${count}`);
        }
      }
    });
  });

  describe('§3.9 sticker count of a sticker card', () => {
    for (const locale of CARD_LOCALES) {
      it(`in ${locale}`, () => {
        for (const [count, text] of COUNTS.stickers[locale]) {
          const display = getFirstPartyCardDisplay(
            firstParty({
              type: 'sticker',
              title: 'Pack',
              sticker_count: count,
            }),
            undefined,
            i18nFor(locale)
          );
          assert.strictEqual(display?.subtitle, text, String(count));
        }
      });
    }
  });

  describe('§3.9 track count of an album and a playlist', () => {
    for (const locale of CARD_LOCALES) {
      it(`in ${locale}, after the artist or author`, () => {
        for (const [count, text] of COUNTS.tracks[locale]) {
          assert.strictEqual(
            subLine(
              structured('music.album', {
                artist: 'Artist',
                track_count: String(count),
              }),
              locale
            ),
            `Artist · ${text}`,
            `album ${count}`
          );
          assert.strictEqual(
            subLine(
              structured('music.playlist', {
                author: 'Author',
                track_count: String(count),
              }),
              locale
            ),
            `Author · ${text}`,
            `playlist ${count}`
          );
        }
      });

      it(`in ${locale}, shows nothing for zero or a number that is not one`, () => {
        for (const value of ['0', '-2', 'many', '']) {
          assert.strictEqual(
            subLine(
              structured('music.album', {
                artist: 'Artist',
                track_count: value,
              }),
              locale
            ),
            'Artist',
            value
          );
        }
      });
    }
  });

  describe('§3.9 publish date of a video', () => {
    // September 3 of this year (the year of `NOW`) and December 1 of the year before.
    const THIS_YEAR = Date.UTC(2026, 8, 3, 12);
    const LAST_YEAR = Date.UTC(2025, 11, 1, 12);
    const DATES: Readonly<
      Record<CardLocaleType, Readonly<{ thisYear: string; lastYear: string }>>
    > = {
      en: { thisYear: 'Sep 3', lastYear: 'Dec 1, 2025' },
      'zh-CN': { thisYear: '9月3日', lastYear: '2025年12月1日' },
      'zh-HK': { thisYear: '9月3日', lastYear: '2025年12月1日' },
      'zh-Hant': { thisYear: '9月3日', lastYear: '2025年12月1日' },
    };

    for (const locale of CARD_LOCALES) {
      it(`in ${locale}: medium length, no time, no year for this year`, () => {
        assert.strictEqual(
          formatLinkCardDate(THIS_YEAR, locale, NOW),
          DATES[locale].thisYear
        );
        assert.strictEqual(
          formatLinkCardDate(LAST_YEAR, locale, NOW),
          DATES[locale].lastYear
        );
      });

      it(`in ${locale}: follows the domain on the domain line of a video card`, () => {
        const i18n = i18nFor(locale);
        for (const [timestamp, text] of [
          [THIS_YEAR, DATES[locale].thisYear],
          [LAST_YEAR, DATES[locale].lastYear],
        ] as const) {
          const { domain } = getLinkPreviewDisplay(
            {
              card: structured('video', {
                author: 'Uploader',
                duration_ms: '212000',
                published_at: new Date(timestamp).toISOString(),
              }),
            },
            i18n,
            NOW
          );
          assert.isString(domain);
          assert.isTrue(domain?.startsWith('music.163.com'), domain);
          assert.isTrue(domain?.endsWith(text), domain);
        }
      });
    }
  });
});
