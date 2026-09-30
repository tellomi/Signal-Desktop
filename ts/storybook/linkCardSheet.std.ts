// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkCardType } from '../linkPreviews/linkCard.std.ts';
import type {
  LinkCardLayoutType,
  LinkCardTintType,
} from '../linkPreviews/linkCardVisual.std.ts';
import type { AttachmentForUIType } from '../types/Attachment.std.ts';
import type { LinkPreviewForUIType } from '../types/message/LinkPreviews.std.ts';
import { IMAGE_PNG } from '../types/MIME.std.ts';
import { fakeAttachment } from '../test-helpers/fakeAttachment.std.ts';

// The data of the link card acceptance sheet (card-visual §3.11): every row of the §3.7 table, in
// two states, "all fields" and "required fields only" (the kinds' `required` in links/kinds.toml).
// Nothing is fetched and nothing is a real page: the cards are written out in the shape of
// rust/links' `Card` (see `fixtures/links/classify-golden.json` for what it really answers), the
// pictures are flat placeholders, the names are made up. What the sheet leaves to rust/links is
// checked against the real bridge by `linkCardSheet_test.preload.ts`: each card's `layout` is what
// `layout()` answers for its picture, each colour is what `tint()` answers for a picture of that
// colour.

// The placeholder pictures are one colour (with a small white disc), so the 32 × 32 reduction the
// card reads is dominated by that colour and `tint()` has one answer per colour.
export const SHEET_COLORS = {
  teal: '#00A1D6',
  yellow: '#FBC800',
  blue: '#0485F9',
  green: '#1DB954',
  pink: '#E8417E',
  purple: '#7B4FD0',
  orange: '#FE7500',
  red: '#E0312B',
  // Grey: not tinted (card-visual §3.3: white, grey and black pictures keep the default card).
  neutral: '#C8C8C8',
} as const;

export type SheetColorType = keyof typeof SHEET_COLORS;

// What rust/links `tint()` answered for a flat picture of each colour (the same for the icon and
// the large-image layout), as the card reads it.
export const SHEET_TINTS: Readonly<Record<SheetColorType, LinkCardTintType>> = {
  teal: {
    tinted: true,
    light: { background: '#00A1D6', text: '#000000' },
    dark: { background: '#007399', text: '#FFFFFF' },
  },
  yellow: {
    tinted: true,
    light: { background: '#FBC800', text: '#000000' },
    dark: { background: '#8F7200', text: '#FFFFFF' },
  },
  blue: {
    tinted: true,
    light: { background: '#0485F9', text: '#000000' },
    dark: { background: '#025097', text: '#FFFFFF' },
  },
  green: {
    tinted: true,
    light: { background: '#1DB954', text: '#000000' },
    dark: { background: '#15843C', text: '#FFFFFF' },
  },
  pink: {
    tinted: true,
    light: { background: '#E8417E', text: '#000000' },
    dark: { background: '#88113C', text: '#FFFFFF' },
  },
  purple: {
    tinted: true,
    light: { background: '#7B4FD0', text: '#FFFFFF' },
    dark: { background: '#3E2079', text: '#FFFFFF' },
  },
  orange: {
    tinted: true,
    light: { background: '#FE7500', text: '#000000' },
    dark: { background: '#994600', text: '#FFFFFF' },
  },
  red: {
    tinted: true,
    light: { background: '#E0312B', text: '#000000' },
    dark: { background: '#851714', text: '#FFFFFF' },
  },
  neutral: { tinted: false },
};

export type SheetCellType = Readonly<{
  preview: LinkPreviewForUIType;
  // The colour of the picture the card draws itself with (the sender's picture, or a brand shell's
  // bundled icon), when it has one: the key into `SHEET_TINTS`.
  pictureColor?: SheetColorType;
  // What this state of the card is, for whoever reads the sheet: a line under the card in the
  // story, not part of the card.
  note?: string;
}>;

export type SheetRowType = Readonly<{
  id: string;
  // The row of the §3.7 table, as the owner's tables name it.
  title: string;
  // The kind (links/kinds.toml), or the level for a row that is not a kind.
  kind: string;
  full: SheetCellType;
  required: SheetCellType;
}>;

// A flat picture of one colour with a white disc in the middle (so that its shape shows where the
// card crops or scales it). The disc is a few percent of the picture: the colour that dominates
// it, and so the answer of `tint()`, is the flat one's.
function placeholderPicture(
  color: SheetColorType,
  width: number,
  height: number
): AttachmentForUIType {
  const radius = Math.round(Math.min(width, height) * 0.2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${SHEET_COLORS[color]}"/>` +
    `<circle cx="50%" cy="50%" r="${radius}" fill="#FFFFFF"/></svg>`;
  return fakeAttachment({
    contentType: IMAGE_PNG,
    fileName: `placeholder-${color}.svg`,
    width,
    height,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  });
}

function makeCard(
  fields: Partial<LinkCardType> & Pick<LinkCardType, 'level' | 'domain'>
): LinkCardType {
  return {
    provider: null,
    provider_name: null,
    kind: null,
    route: null,
    title: null,
    description: null,
    attrs: [],
    official_badge: false,
    first_party: null,
    lookalike: null,
    show_image: true,
    icon: null,
    tintable: true,
    payment: false,
    reason: null,
    ...fields,
  };
}

function makePreview(
  url: string,
  fields: Partial<LinkPreviewForUIType> &
    Readonly<{ card: LinkCardType; layout: LinkCardLayoutType }>
): LinkPreviewForUIType {
  return {
    url,
    domain: new URL(url).hostname,
    isStickerPack: false,
    isCallLink: false,
    ...fields,
  };
}

function structured(
  fields: Pick<LinkCardType, 'provider' | 'provider_name' | 'kind' | 'domain'> &
    Partial<LinkCardType>
): LinkCardType {
  return makeCard({ level: 'structured', route: fields.kind, ...fields });
}

const BILIBILI = { 'zh-Hans': '哔哩哔哩', en: 'Bilibili' } as const;
const TELLOMI = { 'zh-Hans': 'Tellomi', en: 'Tellomi' } as const;

const EXAMPLE_TITLE = 'Launch notes for version 2';
const EXAMPLE_URL = 'https://example.org/2026/launch-notes';

// Plain link: only the URL is used (card-visual §3.5 / §3.7); there is nothing more to add.
const PLAIN: SheetCellType = {
  preview: makePreview('https://www.163.com/news/article/K1234.html', {
    card: makeCard({
      level: 'plain_link',
      domain: '163.com',
      show_image: false,
      tintable: false,
      reason: 'no_title',
    }),
    layout: 'no_image',
  }),
};

const GENERIC_TITLE_ONLY: SheetCellType = {
  preview: makePreview(EXAMPLE_URL, {
    title: EXAMPLE_TITLE,
    card: makeCard({
      level: 'generic',
      domain: 'example.org',
      reason: 'no_rich',
    }),
    layout: 'no_image',
  }),
};

const PAYMENT: SheetCellType = {
  preview: makePreview('https://render.alipay.com/p/f/fd-j5rqp49m/index.html', {
    title: 'Alipay',
    card: makeCard({
      level: 'brand',
      provider: 'alipay',
      provider_name: { 'zh-Hans': '支付宝', en: 'Alipay' },
      kind: 'web',
      domain: 'alipay.com',
      show_image: false,
      tintable: false,
      payment: true,
    }),
    layout: 'no_image',
  }),
};

function tellomiCard(
  kind: string,
  domain: string,
  firstParty: LinkCardType['first_party'],
  fields: Partial<LinkCardType> = {}
): LinkCardType {
  return makeCard({
    level: 'first_party',
    provider: 'tellomi',
    provider_name: TELLOMI,
    kind,
    route: kind.replace('tellomi.', ''),
    domain,
    first_party: firstParty,
    show_image: false,
    tintable: false,
    ...fields,
  });
}

const GROUP_URL = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CALL_URL =
  'https://tell.cc/call/#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';
const STICKER_URL =
  'https://tell.cc/s#pack_id=0123456789abcdef0123456789abcdef&pack_key=abababababababababababababababababababababababababababababababab';

export const SHEET_ROWS: ReadonlyArray<SheetRowType> = [
  {
    id: 'plain-link',
    title: '纯链接',
    kind: 'plain_link',
    full: PLAIN,
    required: PLAIN,
  },
  {
    id: 'generic-large-image',
    title: 'generic · 大图',
    kind: 'generic',
    full: {
      preview: makePreview(EXAMPLE_URL, {
        title: EXAMPLE_TITLE,
        image: placeholderPicture('teal', 1200, 630),
        card: makeCard({
          level: 'generic',
          domain: 'example.org',
          reason: 'no_rich',
        }),
        layout: 'large_image',
      }),
      pictureColor: 'teal',
    },
    required: GENERIC_TITLE_ONLY,
  },
  {
    id: 'generic-icon',
    title: 'generic · 小图',
    kind: 'generic',
    full: {
      preview: makePreview(EXAMPLE_URL, {
        title: EXAMPLE_TITLE,
        image: placeholderPicture('yellow', 100, 100),
        card: makeCard({
          level: 'generic',
          domain: 'example.org',
          reason: 'no_rich',
        }),
        layout: 'icon',
      }),
      pictureColor: 'yellow',
    },
    required: GENERIC_TITLE_ONLY,
  },
  {
    id: 'brand-shell',
    title: '品牌壳 · 有随包图标 / 无图标',
    kind: 'brand',
    full: {
      preview: makePreview('https://item.taobao.com/item.htm?id=100032608854', {
        title: 'Taobao',
        cardIcon: { url: '/link-icons/taobao.png', width: 114, height: 114 },
        card: makeCard({
          level: 'brand',
          provider: 'taobao',
          provider_name: { 'zh-Hans': '淘宝', en: 'Taobao' },
          kind: 'product',
          route: 'item',
          domain: 'taobao.com',
          show_image: false,
          icon: 'taobao.png',
        }),
        layout: 'icon',
      }),
      pictureColor: 'orange',
    },
    required: {
      preview: makePreview(
        'https://g.meituan.com/app/gfe-app-page-tuan/detail-mt.html?dealId=123456789',
        {
          title: 'Meituan',
          card: makeCard({
            level: 'brand',
            provider: 'meituan',
            provider_name: { 'zh-Hans': '美团', en: 'Meituan' },
            kind: 'deal',
            route: 'deal',
            domain: 'meituan.com',
            show_image: false,
          }),
          layout: 'no_image',
        }
      ),
    },
  },
  {
    id: 'payment-shell',
    title: '品牌壳 · 支付壳',
    kind: 'payment',
    full: PAYMENT,
    required: PAYMENT,
  },
  {
    id: 'video',
    title: 'video',
    kind: 'video',
    full: {
      preview: makePreview('https://www.bilibili.com/video/BV1YDhJ6ZEL6', {
        title: 'Learning Go in one afternoon',
        image: placeholderPicture('blue', 1200, 630),
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'video',
          domain: 'bilibili.com',
          title: 'Learning Go in one afternoon',
          attrs: [
            { key: 'author', value: 'Go Channel' },
            { key: 'duration_ms', value: '3723000' },
            { key: 'published_at', value: '2025-12-01T08:00:00+08:00' },
          ],
        }),
        layout: 'large_image',
      }),
      pictureColor: 'blue',
    },
    required: {
      preview: makePreview('https://www.bilibili.com/video/BV1YDhJ6ZEL6', {
        title: 'Learning Go in one afternoon',
        image: placeholderPicture('blue', 1200, 630),
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'video',
          domain: 'bilibili.com',
          title: 'Learning Go in one afternoon',
        }),
        layout: 'large_image',
      }),
      pictureColor: 'blue',
    },
  },
  {
    id: 'channel',
    title: 'channel',
    kind: 'channel',
    full: {
      preview: makePreview('https://live.bilibili.com/1234567', {
        title: 'Go Channel live room',
        image: placeholderPicture('green', 100, 100),
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'channel',
          domain: 'bilibili.com',
          title: 'Go Channel live room',
          attrs: [{ key: 'author', value: 'Go Channel' }],
        }),
        layout: 'icon',
      }),
      pictureColor: 'green',
    },
    required: {
      preview: makePreview('https://live.bilibili.com/1234567', {
        title: 'Go Channel live room',
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'channel',
          domain: 'bilibili.com',
          title: 'Go Channel live room',
        }),
        layout: 'no_image',
      }),
    },
  },
  {
    id: 'music-track',
    title: 'music.track',
    kind: 'music.track',
    full: {
      preview: makePreview('https://music.163.com/song?id=1234567', {
        title: 'Midnight Drive',
        image: placeholderPicture('pink', 300, 300),
        card: structured({
          provider: 'netease-music',
          provider_name: {
            'zh-Hans': '网易云音乐',
            'zh-Hant': '網易雲音樂',
            en: 'NetEase Cloud Music',
          },
          kind: 'music.track',
          domain: '163.com',
          title: 'Midnight Drive',
          attrs: [
            { key: 'artist', value: 'The Night Owls' },
            { key: 'album', value: 'City Lights' },
            { key: 'duration_ms', value: '225000' },
          ],
        }),
        layout: 'icon',
      }),
      pictureColor: 'pink',
    },
    required: {
      preview: makePreview('https://music.163.com/song?id=1234567', {
        title: 'Midnight Drive',
        card: structured({
          provider: 'netease-music',
          provider_name: {
            'zh-Hans': '网易云音乐',
            'zh-Hant': '網易雲音樂',
            en: 'NetEase Cloud Music',
          },
          kind: 'music.track',
          domain: '163.com',
          title: 'Midnight Drive',
        }),
        layout: 'no_image',
      }),
    },
  },
  {
    id: 'music-album',
    title: 'music.album',
    kind: 'music.album',
    full: {
      preview: makePreview(
        'https://open.spotify.com/album/0aBcDeFgHiJkLmNoPqRsTu',
        {
          title: 'City Lights',
          image: placeholderPicture('purple', 640, 640),
          card: structured({
            provider: 'spotify',
            provider_name: { 'zh-Hans': 'Spotify', en: 'Spotify' },
            kind: 'music.album',
            domain: 'spotify.com',
            title: 'City Lights',
            attrs: [
              { key: 'artist', value: 'The Night Owls' },
              { key: 'track_count', value: '12' },
            ],
          }),
          layout: 'large_image',
        }
      ),
      pictureColor: 'purple',
    },
    required: {
      preview: makePreview(
        'https://open.spotify.com/album/0aBcDeFgHiJkLmNoPqRsTu',
        {
          title: 'City Lights',
          card: structured({
            provider: 'spotify',
            provider_name: { 'zh-Hans': 'Spotify', en: 'Spotify' },
            kind: 'music.album',
            domain: 'spotify.com',
            title: 'City Lights',
          }),
          layout: 'no_image',
        }
      ),
    },
  },
  {
    id: 'music-playlist',
    title: 'music.playlist',
    kind: 'music.playlist',
    full: {
      preview: makePreview('https://music.163.com/playlist?id=7654321', {
        title: 'Late night drive',
        image: placeholderPicture('orange', 300, 300),
        card: structured({
          provider: 'netease-music',
          provider_name: {
            'zh-Hans': '网易云音乐',
            'zh-Hant': '網易雲音樂',
            en: 'NetEase Cloud Music',
          },
          kind: 'music.playlist',
          domain: '163.com',
          title: 'Late night drive',
          attrs: [
            { key: 'author', value: 'A Curator' },
            { key: 'track_count', value: '30' },
          ],
        }),
        layout: 'icon',
      }),
      pictureColor: 'orange',
    },
    required: {
      preview: makePreview('https://music.163.com/playlist?id=7654321', {
        title: 'Late night drive',
        card: structured({
          provider: 'netease-music',
          provider_name: {
            'zh-Hans': '网易云音乐',
            'zh-Hant': '網易雲音樂',
            en: 'NetEase Cloud Music',
          },
          kind: 'music.playlist',
          domain: '163.com',
          title: 'Late night drive',
        }),
        layout: 'no_image',
      }),
    },
  },
  {
    id: 'place',
    title: 'place',
    kind: 'place',
    full: {
      preview: makePreview(
        'https://uri.amap.com/marker?position=121.49,31.24&name=The+Bund',
        {
          title: 'The Bund',
          image: placeholderPicture('red', 512, 512),
          card: structured({
            provider: 'amap',
            provider_name: { 'zh-Hans': '高德地图', en: 'Amap' },
            kind: 'place',
            domain: 'amap.com',
            title: 'The Bund',
            attrs: [
              {
                key: 'address',
                value: 'Zhongshan East 1st Road, Huangpu, Shanghai',
              },
              { key: 'coord_sys', value: 'gcj02' },
              { key: 'lat', value: '31.24' },
              { key: 'lng', value: '121.49' },
              { key: 'name', value: 'The Bund' },
            ],
          }),
          layout: 'icon',
        }
      ),
      pictureColor: 'red',
    },
    required: {
      preview: makePreview(
        'https://uri.amap.com/marker?position=121.49,31.24',
        {
          title: 'Amap',
          card: structured({
            provider: 'amap',
            provider_name: { 'zh-Hans': '高德地图', en: 'Amap' },
            kind: 'place',
            domain: 'amap.com',
            title: 'Amap',
            attrs: [
              { key: 'coord_sys', value: 'gcj02' },
              { key: 'lat', value: '31.24' },
              { key: 'lng', value: '121.49' },
            ],
          }),
          layout: 'no_image',
        }
      ),
    },
  },
  {
    id: 'app',
    title: 'app',
    kind: 'app',
    full: {
      preview: makePreview(
        'https://apps.apple.com/us/app/pocket-notes/id123456789',
        {
          title: 'Pocket Notes',
          image: placeholderPicture('blue', 512, 512),
          card: structured({
            provider: 'app-store',
            provider_name: { 'zh-Hans': 'App Store', en: 'App Store' },
            kind: 'app',
            domain: 'apple.com',
            title: 'Pocket Notes',
            attrs: [
              { key: 'developer', value: 'Example Studio' },
              { key: 'platform', value: 'ios' },
            ],
          }),
          layout: 'icon',
        }
      ),
      pictureColor: 'blue',
    },
    required: {
      preview: makePreview(
        'https://apps.apple.com/us/app/pocket-notes/id123456789',
        {
          title: 'Pocket Notes',
          image: placeholderPicture('blue', 512, 512),
          card: structured({
            provider: 'app-store',
            provider_name: { 'zh-Hans': 'App Store', en: 'App Store' },
            kind: 'app',
            domain: 'apple.com',
            title: 'Pocket Notes',
          }),
          layout: 'icon',
        }
      ),
      pictureColor: 'blue',
    },
  },
  {
    id: 'repo',
    title: 'repo',
    kind: 'repo',
    full: {
      preview: makePreview('https://github.com/octo-org/hello-world', {
        title: 'octo-org/hello-world',
        image: placeholderPicture('neutral', 420, 420),
        card: structured({
          provider: 'github',
          provider_name: { 'zh-Hans': 'GitHub', en: 'GitHub' },
          kind: 'repo',
          domain: 'github.com',
          title: 'octo-org/hello-world',
          attrs: [{ key: 'owner', value: 'octo-org' }],
        }),
        layout: 'icon',
      }),
      pictureColor: 'neutral',
    },
    required: {
      preview: makePreview('https://github.com/octo-org/hello-world', {
        title: 'octo-org/hello-world',
        card: structured({
          provider: 'github',
          provider_name: { 'zh-Hans': 'GitHub', en: 'GitHub' },
          kind: 'repo',
          domain: 'github.com',
          title: 'octo-org/hello-world',
        }),
        layout: 'no_image',
      }),
    },
  },
  {
    id: 'first-party-user',
    title: '第一方 · user',
    kind: 'tellomi.user',
    full: {
      preview: makePreview('https://tell.cc/kaixin.57', {
        card: tellomiCard('tellomi.user', 'tell.cc', {
          type: 'user',
          display: '@kaixin.57',
          username: 'kaixin.57',
        }),
        layout: 'first_party',
        // The reader has a chat with this user: name and picture come from this device.
        firstPartyLocal: {
          knownUser: {
            title: 'Kai Xin',
            avatarUrl: placeholderPicture('teal', 96, 96).url,
            hasAvatar: true,
          },
        },
      }),
      note: '本地认识 → 真头像',
    },
    required: {
      // Nothing from this device: the card draws the default avatar (card-visual §5.2), not the
      // initials of "Tellomi user".
      preview: makePreview(
        'https://tell.cc/u#eu/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        {
          card: tellomiCard('tellomi.user', 'tell.cc', {
            type: 'user',
            display: null,
            username: null,
          }),
          layout: 'first_party',
        }
      ),
      note: '本地不认识 → 默认头像，不画首字母',
    },
  },
  {
    id: 'first-party-group',
    title: '第一方 · group',
    kind: 'tellomi.group',
    full: {
      preview: makePreview(GROUP_URL, {
        title: '周末爬山群',
        image: placeholderPicture('green', 320, 240),
        card: tellomiCard(
          'tellomi.group',
          'tell.cc',
          { type: 'group', title: '周末爬山群', member_count: 128 },
          { show_image: true }
        ),
        layout: 'first_party',
      }),
    },
    required: {
      preview: makePreview(GROUP_URL, {
        title: '周末爬山群',
        card: tellomiCard(
          'tellomi.group',
          'tell.cc',
          { type: 'group', title: '周末爬山群', member_count: null },
          { show_image: true }
        ),
        layout: 'first_party',
      }),
    },
  },
  {
    id: 'first-party-call',
    title: '第一方 · call',
    kind: 'tellomi.call',
    full: {
      preview: makePreview(CALL_URL, {
        title: 'Camping Prep',
        isCallLink: true,
        card: tellomiCard('tellomi.call', 'tell.cc', {
          type: 'call',
          title: 'Camping Prep',
        }),
        layout: 'first_party',
      }),
    },
    required: {
      preview: makePreview(CALL_URL, {
        isCallLink: true,
        card: tellomiCard('tellomi.call', 'tell.cc', {
          type: 'call',
          title: null,
        }),
        layout: 'first_party',
      }),
    },
  },
  {
    id: 'first-party-sticker',
    title: '第一方 · sticker',
    kind: 'tellomi.sticker',
    full: {
      preview: makePreview(STICKER_URL, {
        title: 'Bandit the Cat',
        isStickerPack: true,
        image: placeholderPicture('pink', 512, 512),
        card: tellomiCard(
          'tellomi.sticker',
          'tell.cc',
          { type: 'sticker', title: 'Bandit the Cat', sticker_count: 24 },
          { show_image: true }
        ),
        layout: 'first_party',
      }),
    },
    required: {
      preview: makePreview(STICKER_URL, {
        title: 'Bandit the Cat',
        isStickerPack: true,
        card: tellomiCard(
          'tellomi.sticker',
          'tell.cc',
          { type: 'sticker', title: 'Bandit the Cat', sticker_count: null },
          { show_image: true }
        ),
        layout: 'first_party',
      }),
    },
  },
  {
    id: 'first-party-official',
    title: '第一方 · official',
    kind: 'tellomi.official',
    full: {
      preview: makePreview('https://tellomi.app/download', {
        card: tellomiCard(
          'tellomi.official',
          'tellomi.app',
          { type: 'official', path: '/download' },
          { official_badge: true }
        ),
        layout: 'first_party',
      }),
    },
    required: {
      preview: makePreview('https://tellomi.app/', {
        card: tellomiCard(
          'tellomi.official',
          'tellomi.app',
          { type: 'official', path: '/' },
          { official_badge: true }
        ),
        layout: 'first_party',
      }),
    },
  },
  {
    id: 'unknown-kind',
    title: '不认识的 kind（新注册表、旧客户端）',
    kind: 'podcast',
    full: {
      preview: makePreview('https://www.bilibili.com/podcast/ep1', {
        title: 'Episode 1',
        image: placeholderPicture('purple', 1200, 630),
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'podcast',
          domain: 'bilibili.com',
          title: 'Episode 1',
          attrs: [{ key: 'host', value: 'A Host' }],
        }),
        layout: 'large_image',
      }),
      pictureColor: 'purple',
    },
    required: {
      preview: makePreview('https://www.bilibili.com/podcast/ep1', {
        title: 'Episode 1',
        card: structured({
          provider: 'bilibili',
          provider_name: BILIBILI,
          kind: 'podcast',
          domain: 'bilibili.com',
          title: 'Episode 1',
        }),
        layout: 'no_image',
      }),
    },
  },
];
