// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import lodash from 'lodash';
import { assert } from 'chai';

import type { LocaleMessagesType } from '../../types/I18N.std.ts';
import type { LocalizerType } from '../../types/Util.std.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import {
  getFirstPartyCardDisplay,
  type FirstPartyCardDisplayType,
  type FirstPartyLocalType,
} from '../../linkPreviews/firstPartyCard.std.ts';
import {
  getFirstPartyCardAriaLabel,
  getLinkCardAriaLabel,
} from '../../linkPreviews/linkCardA11y.std.ts';
import { setupI18n } from '../../util/setupI18nMain.std.ts';
import { shouldNeverBeCalled } from '../../util/shouldNeverBeCalled.std.ts';

const { merge } = lodash;

// card-visual §3.6 (2026-09-29): what a screen reader says for a card. A link card: "Link, <title>,
// <domain>"; a Tellomi object's card: "Tellomi group, <name>, <members>, button: Join" as one
// sentence. The words are the same on all three platforms (the table in the brief for this wave,
// `a11y-strings.md`); a missing part is skipped, not left as an empty slot.

// The five strings of the table, verbatim, per language. Desktop writes the action of "button: %1$s"
// as the ICU argument {action}; nothing else differs.
const TABLE = {
  en: {
    separator: ', ',
    link: 'Link',
    button: 'button: %1$s',
    group: 'Tellomi group',
    stickerPack: 'Tellomi sticker pack',
  },
  'zh-CN': {
    separator: '，',
    link: '链接',
    button: '按钮：%1$s',
    group: 'Tellomi 群组',
    stickerPack: 'Tellomi 贴纸包',
  },
  'zh-HK': {
    separator: '，',
    link: '連結',
    button: '按鈕：%1$s',
    group: 'Tellomi 群組',
    stickerPack: 'Tellomi 貼圖包',
  },
  'zh-Hant': {
    separator: '，',
    link: '連結',
    button: '按鈕：%1$s',
    group: 'Tellomi 群組',
    stickerPack: 'Tellomi 貼圖包',
  },
} as const;

type LocaleName = keyof typeof TABLE;
const LOCALES = Object.keys(TABLE) as Array<LocaleName>;

const LOCALES_DIR = join(__dirname, '..', '..', '..', '_locales');

function readMessages(locale: string): LocaleMessagesType {
  return JSON.parse(
    readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8')
  );
}

// As the app loads a language: English underneath, the language on top (`app/locale.node.ts`).
function loadI18n(locale: LocaleName): LocalizerType {
  return setupI18n(locale, merge(readMessages('en'), readMessages(locale)), {
    renderEmojify: shouldNeverBeCalled,
    getLocaleDirection: shouldNeverBeCalled,
    getHourCyclePreference: shouldNeverBeCalled,
  });
}

const BASE: LinkCardType = {
  level: 'first_party',
  provider: 'tellomi',
  provider_name: null,
  kind: null,
  route: null,
  title: null,
  description: null,
  attrs: [],
  domain: 'tell.cc',
  official_badge: false,
  first_party: null,
  lookalike: null,
  show_image: false,
  tintable: false,
  payment: false,
  reason: null,
};

type FirstPartyCase = Readonly<{
  name: string;
  card: LinkCardType;
  local?: FirstPartyLocalType;
  // Per language: the whole sentence.
  expected: Readonly<Record<LocaleName, string>>;
}>;

const group = (memberCount: number | null): LinkCardType => ({
  ...BASE,
  kind: 'tellomi.group',
  first_party: { type: 'group', title: 'Book club', member_count: memberCount },
});
const user = (display: string | null): LinkCardType => ({
  ...BASE,
  kind: 'tellomi.user',
  first_party: { type: 'user', display, username: display ? 'kaixin' : null },
});
const call = (title: string | null): LinkCardType => ({
  ...BASE,
  kind: 'tellomi.call',
  first_party: { type: 'call', title },
});
const sticker = (count: number | null): LinkCardType => ({
  ...BASE,
  kind: 'tellomi.sticker',
  first_party: { type: 'sticker', title: 'Bandit', sticker_count: count },
});
const official: LinkCardType = {
  ...BASE,
  kind: 'tellomi.official',
  domain: 'tellomi.app',
  official_badge: true,
  first_party: { type: 'official', path: '/download' },
};

const FIRST_PARTY_CASES: ReadonlyArray<FirstPartyCase> = [
  {
    name: 'a group the reader is not in',
    card: group(12),
    expected: {
      en: 'Tellomi group, Book club, 12 members, button: Join Group',
      'zh-CN': 'Tellomi 群组，Book club，12 位成员，按钮：加入群聊',
      'zh-HK': 'Tellomi 群組，Book club，12 個成員，按鈕：加入群組',
      'zh-Hant': 'Tellomi 群組，Book club，12 個成員，按鈕：加入群組',
    },
  },
  {
    name: 'a group without a member count',
    card: group(null),
    expected: {
      en: 'Tellomi group, Book club, button: Join Group',
      'zh-CN': 'Tellomi 群组，Book club，按钮：加入群聊',
      'zh-HK': 'Tellomi 群組，Book club，按鈕：加入群組',
      'zh-Hant': 'Tellomi 群組，Book club，按鈕：加入群組',
    },
  },
  {
    name: 'a group the reader is in',
    card: group(12),
    local: { isGroupMember: true },
    expected: {
      en: 'Tellomi group, Book club, You’re a member, button: Open',
      'zh-CN': 'Tellomi 群组，Book club，你已加入，按钮：打开',
      'zh-HK': 'Tellomi 群組，Book club，你已加入，按鈕：開啟',
      'zh-Hant': 'Tellomi 群組，Book club，你已加入，按鈕：開啟',
    },
  },
  {
    name: 'a user known to the reader (the subtitle repeats the kind and is left out)',
    card: user('@kaixin'),
    expected: {
      en: 'Tellomi user, @kaixin, button: Message',
      'zh-CN': 'Tellomi 用户，@kaixin，按钮：发消息',
      'zh-HK': 'Tellomi 用戶，@kaixin，按鈕：傳送訊息',
      'zh-Hant': 'Tellomi 用戶，@kaixin，按鈕：傳送訊息',
    },
  },
  {
    name: 'a user with no readable name (the title is the kind, said once)',
    card: user(null),
    expected: {
      en: 'Tellomi user, button: Message',
      'zh-CN': 'Tellomi 用户，按钮：发消息',
      'zh-HK': 'Tellomi 用戶，按鈕：傳送訊息',
      'zh-Hant': 'Tellomi 用戶，按鈕：傳送訊息',
    },
  },
  {
    name: 'a call with a room name',
    card: call('Camping Prep'),
    expected: {
      en: 'Tellomi call, Camping Prep, button: Join Call',
      'zh-CN': 'Tellomi 通话，Camping Prep，按钮：加入通话',
      'zh-HK': 'Tellomi 通話，Camping Prep，按鈕：加入通話',
      'zh-Hant': 'Tellomi 通話，Camping Prep，按鈕：加入通話',
    },
  },
  {
    name: 'a call without one (the title is the kind, said once)',
    card: call(null),
    expected: {
      en: 'Tellomi call, button: Join Call',
      'zh-CN': 'Tellomi 通话，按钮：加入通话',
      'zh-HK': 'Tellomi 通話，按鈕：加入通話',
      'zh-Hant': 'Tellomi 通話，按鈕：加入通話',
    },
  },
  {
    name: 'a sticker pack not added yet',
    card: sticker(24),
    expected: {
      en: 'Tellomi sticker pack, Bandit, 24 stickers, button: Add',
      'zh-CN': 'Tellomi 贴纸包，Bandit，24 个贴纸，按钮：添加',
      'zh-HK': 'Tellomi 貼圖包，Bandit，24 個貼圖，按鈕：新增',
      'zh-Hant': 'Tellomi 貼圖包，Bandit，24 個貼圖，按鈕：新增',
    },
  },
  {
    name: 'a sticker pack already added',
    card: sticker(24),
    local: { isStickerPackInstalled: true },
    expected: {
      en: 'Tellomi sticker pack, Bandit, Added, button: View',
      'zh-CN': 'Tellomi 贴纸包，Bandit，已添加，按钮：查看',
      'zh-HK': 'Tellomi 貼圖包，Bandit，已新增，按鈕：查看',
      'zh-Hant': 'Tellomi 貼圖包，Bandit，已新增，按鈕：查看',
    },
  },
  {
    name: 'the official site (the title is the kind, said once; the path follows)',
    card: official,
    expected: {
      en: 'Tellomi website, /download, button: Open',
      'zh-CN': 'Tellomi 官网，/download，按钮：打开',
      'zh-HK': 'Tellomi 官網，/download，按鈕：開啟',
      'zh-Hant': 'Tellomi 官網，/download，按鈕：開啟',
    },
  },
];

function displayOf(
  card: LinkCardType,
  local: FirstPartyLocalType | undefined,
  i18n: LocalizerType
): FirstPartyCardDisplayType {
  const display = getFirstPartyCardDisplay(card, local, i18n);
  if (!display) {
    throw new Error('not a first-party card');
  }
  return display;
}

describe('card screen reader text', () => {
  describe('the five strings are the table, verbatim, in every language', () => {
    for (const locale of LOCALES) {
      it(locale, () => {
        const i18n = loadI18n(locale);
        const expected = TABLE[locale];
        assert.strictEqual(
          i18n('icu:TellomiLinkCard__a11y_separator'),
          expected.separator
        );
        assert.strictEqual(
          i18n('icu:TellomiLinkCard__a11y_link'),
          expected.link
        );
        assert.strictEqual(
          i18n(
            'icu:TellomiLinkCard__a11y_button_with_action',
            { action: '%1$s' },
            { bidi: 'strip' }
          ),
          expected.button
        );
        assert.strictEqual(
          i18n('icu:TellomiLinkCard__a11y_kind_group'),
          expected.group
        );
        assert.strictEqual(
          i18n('icu:TellomiLinkCard__a11y_kind_sticker_pack'),
          expected.stickerPack
        );
      });
    }

    it('are written out in the locale files, not borrowed from English', () => {
      for (const locale of ['zh-CN', 'zh-HK', 'zh-Hant']) {
        const messages = readMessages(locale);
        for (const key of [
          'icu:TellomiLinkCard__a11y_separator',
          'icu:TellomiLinkCard__a11y_link',
          'icu:TellomiLinkCard__a11y_button_with_action',
          'icu:TellomiLinkCard__a11y_kind_group',
          'icu:TellomiLinkCard__a11y_kind_sticker_pack',
        ]) {
          assert.isString(
            (messages[key] as { messageformat?: unknown } | undefined)
              ?.messageformat,
            `${locale} ${key}`
          );
        }
      }
    });

    it('falls back to English in a language that has none of them', () => {
      const i18n = setupI18n('de', readMessages('en'), {
        renderEmojify: shouldNeverBeCalled,
        getLocaleDirection: shouldNeverBeCalled,
        getHourCyclePreference: shouldNeverBeCalled,
      });
      assert.strictEqual(
        getLinkCardAriaLabel(i18n, { title: 'Title', domain: 'a.com' }),
        'Link, Title, a.com'
      );
    });
  });

  describe('a link card: Link, title, domain', () => {
    const EXPECTED = {
      en: 'Link, Ke Jie Go Course, bilibili.com',
      'zh-CN': '链接，Ke Jie Go Course，bilibili.com',
      'zh-HK': '連結，Ke Jie Go Course，bilibili.com',
      'zh-Hant': '連結，Ke Jie Go Course，bilibili.com',
    } as const;
    const PLAIN = {
      en: 'Link, bilibili.com',
      'zh-CN': '链接，bilibili.com',
      'zh-HK': '連結，bilibili.com',
      'zh-Hant': '連結，bilibili.com',
    } as const;

    for (const locale of LOCALES) {
      it(`in ${locale}`, () => {
        const i18n = loadI18n(locale);
        assert.strictEqual(
          getLinkCardAriaLabel(i18n, {
            title: 'Ke Jie Go Course',
            domain: 'bilibili.com',
          }),
          EXPECTED[locale]
        );
        // A plain link has no title: the domain is said once.
        assert.strictEqual(
          getLinkCardAriaLabel(i18n, {
            title: undefined,
            domain: 'bilibili.com',
          }),
          PLAIN[locale]
        );
        assert.strictEqual(
          getLinkCardAriaLabel(i18n, {
            title: 'bilibili.com',
            domain: 'bilibili.com',
          }),
          PLAIN[locale],
          'the same words are not said twice'
        );
      });
    }

    it('skips a part that is missing or blank', () => {
      const i18n = loadI18n('en');
      assert.strictEqual(
        getLinkCardAriaLabel(i18n, { title: 'Title', domain: undefined }),
        'Link, Title'
      );
      assert.strictEqual(
        getLinkCardAriaLabel(i18n, { title: '  ', domain: '' }),
        'Link'
      );
      assert.strictEqual(
        getLinkCardAriaLabel(i18n, { title: ' Title ', domain: 'a.com' }),
        'Link, Title, a.com'
      );
    });
  });

  describe("a Tellomi object's card: kind, name, detail, button: action", () => {
    for (const locale of LOCALES) {
      describe(locale, () => {
        const i18n = loadI18n(locale);
        for (const testCase of FIRST_PARTY_CASES) {
          it(testCase.name, () => {
            assert.strictEqual(
              getFirstPartyCardAriaLabel(
                i18n,
                displayOf(testCase.card, testCase.local, i18n)
              ),
              testCase.expected[locale]
            );
          });
        }
      });
    }
  });
});
