// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { nativeImage } from 'electron';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Bytes from '../../Bytes.std.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import { parseLinkCard } from '../../linkPreviews/linkCard.std.ts';
import {
  getLinkCardTintColors,
  shouldTintLinkCard,
} from '../../linkPreviews/linkCardVisual.std.ts';
import {
  _setLinkRegistryForTesting,
  classifyLinkPreview,
  getBundledLinkIcon,
  getLinkCardBrandIcon,
  getLinkCardLayout,
  tintLinkCardImage,
} from '../../linkPreviews/linkRegistry.preload.ts';

// ADR-0063 §九.6, card-visual §3.7 / §3.3 (tellomi/tellomi#1421): a brand shell draws the icon that
// ships with the app, in the icon card, tinted by that icon's own pixels; payment shells, shells
// without an icon and cards in a message request keep the neutral look. This runs the same calls the
// message selector and the card make, through the real rust/links.

type GoldenCase = Readonly<{
  name: string;
  preview: string;
  body: string;
  message: string;
  card: string;
}>;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<GoldenCase>;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

// `layout` cases for a brand shell, copied from libsignal's rust/links/tests/data/bridge-golden.json
// (tellomi-0.100.0 fa18dca81): a 114 px icon, the sender's big picture (never passed for a brand
// shell any more, still an icon), and no picture at all.
const BRAND_LAYOUT_GOLDEN: ReadonlyArray<
  Readonly<{ width: number; height: number; layout: string }>
> = [
  { width: 114, height: 114, layout: 'icon' },
  { width: 1200, height: 630, layout: 'icon' },
  { width: 0, height: 0, layout: 'no_image' },
];

function goldenCard(name: string): LinkCardType {
  const found = golden.classify.find(testCase => testCase.name === name);
  assert.isDefined(found, name);
  const card = parseLinkCard(found?.card ?? '');
  assert.isDefined(card, name);
  return card;
}

function withIcon(card: LinkCardType, icon: unknown): LinkCardType {
  const parsed = parseLinkCard(JSON.stringify({ ...card, icon }));
  assert.isDefined(parsed);
  return parsed;
}

// The icon the way the card's canvas reads it: decoded and reduced to 32 × 32 RGBA.
function reducedRgba(pngUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = pngUrl.slice('data:image/png;base64,'.length);
  const image = nativeImage
    .createFromBuffer(Buffer.from(Bytes.fromBase64(base64)))
    .resize({ width: 32, height: 32, quality: 'best' });
  const bgra = image.toBitmap();
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2] ?? 0;
    rgba[i + 1] = bgra[i + 1] ?? 0;
    rgba[i + 2] = bgra[i] ?? 0;
    rgba[i + 3] = bgra[i + 3] ?? 0;
  }
  return rgba;
}

function solidRgba(red: number, green: number, blue: number) {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = red;
    rgba[i + 1] = green;
    rgba[i + 2] = blue;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function hueOf(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return (hue * 60 + 360) % 360;
}

describe('brand shell icon', () => {
  const contextConfig = window.SignalContext.config as { installPath?: string };
  let previousInstallPath: string | undefined;

  before(() => {
    previousInstallPath = contextConfig.installPath;
    // The renderer's `installPath` is the app's root; under test that is this checkout.
    contextConfig.installPath = cwd();
  });

  after(() => {
    contextConfig.installPath = previousInstallPath;
  });

  beforeEach(() => {
    _setLinkRegistryForTesting(undefined);
  });

  afterEach(() => {
    _setLinkRegistryForTesting(undefined);
  });

  const TAOBAO =
    '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs';
  const ALIPAY = 'payment platform: brand, locked, never tinted';

  describe('rust/links names the file', () => {
    it('taobao names taobao.png, a payment shell names none, every other golden card too', () => {
      assert.strictEqual(goldenCard(TAOBAO).icon, 'taobao.png');
      assert.isNull(goldenCard(ALIPAY).icon);
      for (const testCase of golden.classify) {
        const card = parseLinkCard(testCase.card);
        if (testCase.name === TAOBAO) {
          continue;
        }
        assert.isNull(card?.icon, testCase.name);
      }
    });

    it('comes out of the real bridge the same way', () => {
      _setLinkRegistryForTesting(
        LinkRegistry.load(
          new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
        )
      );
      const found = golden.classify.find(testCase => testCase.name === TAOBAO);
      const preview = JSON.parse(found?.preview ?? '{}');
      const card = classifyLinkPreview(
        {
          url: preview.url,
          title: preview.title,
          hasImage: true,
          rich: preview.rich
            ? Bytes.toBase64(Bytes.fromHex(preview.rich))
            : undefined,
        },
        found?.body ?? '',
        { isStory: false, attachmentContentTypes: [] }
      );
      assert.strictEqual(card?.level, 'brand');
      assert.strictEqual(card?.icon, 'taobao.png');
      assert.isFalse(card?.show_image, "the sender's picture stays hidden");
    });
  });

  describe('a brand shell with a bundled icon', () => {
    const card = goldenCard(TAOBAO);

    it('reads the icon from the files that ship, at its own size', () => {
      const icon = getLinkCardBrandIcon(card);
      assert.strictEqual(icon?.width, 114);
      assert.strictEqual(icon?.height, 114);
      assert.match(icon?.url ?? '', /^data:image\/png;base64,/);
      assert.strictEqual(
        getLinkCardBrandIcon(card),
        icon,
        'read once, then the same object'
      );
    });

    it('is an icon card: layout() decides it from the icon size', () => {
      const icon = getLinkCardBrandIcon(card);
      assert.strictEqual(
        getLinkCardLayout(
          icon?.width ?? 0,
          icon?.height ?? 0,
          card.kind ?? '',
          card.level
        ),
        'icon'
      );
    });

    it('layout() answers the brand cases of the shared golden', () => {
      for (const { width, height, layout } of BRAND_LAYOUT_GOLDEN) {
        assert.strictEqual(
          getLinkCardLayout(width, height, 'product', 'brand'),
          layout,
          `${width}x${height}`
        );
      }
    });

    it('is tinted from the icon own pixels, with the colours tint() gives, unchanged', () => {
      const icon = getLinkCardBrandIcon(card);
      assert.isDefined(icon);
      assert.isTrue(
        shouldTintLinkCard({ card, layout: 'icon', isMessageRequest: false })
      );

      const tint = tintLinkCardImage(
        'icon',
        32,
        32,
        reducedRgba(icon?.url ?? '')
      );
      assert.isTrue(tint?.tinted, "taobao's orange is not a neutral colour");
      const light = getLinkCardTintColors(tint, 'light');
      const dark = getLinkCardTintColors(tint, 'dark');
      assert.match(light?.background ?? '', /^#[0-9A-F]{6}$/);
      const hue = hueOf(light?.background ?? '#000000');
      assert.isAtLeast(hue, 10, `orange hue, got ${hue}`);
      assert.isAtMost(hue, 40, `orange hue, got ${hue}`);
      assert.notStrictEqual(light?.background, dark?.background);
      assert.strictEqual(dark?.text, '#FFFFFF', 'dark mode: white text');

      // The colours follow the pixels that were passed in, nothing else.
      const blue = tintLinkCardImage('icon', 32, 32, solidRgba(0, 90, 220));
      assert.notStrictEqual(
        getLinkCardTintColors(blue, 'light')?.background,
        light?.background
      );
      assert.isAtLeast(
        hueOf(getLinkCardTintColors(blue, 'light')?.background ?? '#000000'),
        200
      );
      // A grey picture is neutral: the default card colours stay.
      assert.isFalse(
        tintLinkCardImage('icon', 32, 32, solidRgba(128, 128, 130))?.tinted
      );
    });

    it('is never tinted in a message request, but still shows its icon', () => {
      assert.isFalse(
        shouldTintLinkCard({ card, layout: 'icon', isMessageRequest: true })
      );
      assert.isDefined(getLinkCardBrandIcon(card));
    });
  });

  describe('payment shells', () => {
    const card = goldenCard(ALIPAY);

    it('have no icon, keep the no-image shape, and are never tinted', () => {
      assert.isUndefined(getLinkCardBrandIcon(card));
      const layout = getLinkCardLayout(0, 0, card.kind ?? '', card.level);
      assert.strictEqual(layout, 'no_image');
      assert.isFalse(
        shouldTintLinkCard({ card, layout, isMessageRequest: false })
      );
    });

    it('stay untinted even if a hot-updated registry gave them an icon', () => {
      const withBundledIcon = withIcon(card, 'taobao.png');
      const icon = getLinkCardBrandIcon(withBundledIcon);
      assert.isDefined(icon);
      assert.isFalse(
        shouldTintLinkCard({
          card: withBundledIcon,
          layout: 'icon',
          isMessageRequest: false,
        })
      );
    });
  });

  describe('a brand shell without an icon, or whose icon is not bundled', () => {
    it('is as before: no icon, no picture, no tint', () => {
      _setLinkRegistryForTesting(
        LinkRegistry.load(
          new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
        )
      );
      const url =
        'https://g.meituan.com/app/gfe-app-page-tuan/detail-mt.html?dealId=123456789';
      const card = classifyLinkPreview(
        {
          url,
          title: '美团团购',
          hasImage: true,
          // RichContent: kind "deal", provider "meituan", level 1 (a brand shell)
          rich: Bytes.toBase64(
            Bytes.fromHex('0a046465616c12076d65697475616e3001')
          ),
        },
        url,
        { isStory: false, attachmentContentTypes: [] }
      );
      assert.strictEqual(card?.provider, 'meituan');
      assert.strictEqual(card?.level, 'brand');
      assert.isNull(card?.icon);
      assert.isUndefined(getLinkCardBrandIcon(card));
      const layout = getLinkCardLayout(0, 0, card?.kind ?? '', 'brand');
      assert.strictEqual(layout, 'no_image');
      assert.isFalse(
        shouldTintLinkCard({ card, layout, isMessageRequest: false })
      );
    });

    it('is the same for an icon that is named but not bundled', () => {
      const card = withIcon(goldenCard(TAOBAO), 'newbrand.png');
      assert.strictEqual(card.icon, 'newbrand.png');
      assert.isUndefined(getBundledLinkIcon('newbrand.png'));
      assert.isUndefined(getLinkCardBrandIcon(card));
      assert.strictEqual(
        getLinkCardLayout(0, 0, card.kind ?? '', card.level),
        'no_image'
      );
    });

    it('is the same for a name that tries to leave the icons directory', () => {
      const card = withIcon(goldenCard(TAOBAO), '../links-2026092702.json');
      assert.isNull(card.icon, 'the card never carries such a name');
      assert.isUndefined(getBundledLinkIcon('../links-2026092702.json'));
      assert.isUndefined(getBundledLinkIcon('../icons/taobao.png'));
    });

    it('is the same when the app path is not known', () => {
      contextConfig.installPath = undefined;
      _setLinkRegistryForTesting(undefined);
      try {
        assert.isUndefined(getBundledLinkIcon('taobao.png'));
      } finally {
        contextConfig.installPath = cwd();
        _setLinkRegistryForTesting(undefined);
      }
      assert.isDefined(getBundledLinkIcon('taobao.png'));
    });
  });

  describe('only a brand shell shows a bundled icon', () => {
    it('ignores an icon on any other level', () => {
      for (const level of ['generic', 'structured', 'plain_link']) {
        const card = parseLinkCard(
          JSON.stringify({ ...goldenCard(TAOBAO), level, icon: 'taobao.png' })
        );
        assert.isDefined(card);
        assert.isUndefined(getLinkCardBrandIcon(card), level);
      }
      assert.isUndefined(getLinkCardBrandIcon(undefined));
    });
  });
});
