// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Bytes from '../../Bytes.std.ts';
import { Message } from '../../components/conversation/Message.dom.tsx';
import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import type {
  ConversationType,
  MessageWithUIFieldsType,
} from '../../state/ducks/conversations.preload.ts';
import {
  getPropsForBubble,
  type GetPropsForBubbleOptions,
  type MessagePropsType,
} from '../../state/selectors/message.preload.ts';
import { getDefaultConversation } from '../../test-helpers/getDefaultConversation.std.ts';
import { IMAGE_JPEG } from '../../types/MIME.std.ts';
import type { LinkPreviewForUIType } from '../../types/message/LinkPreviews.std.ts';
import i18n from '../util/i18n.node.ts';

// card-visual §3.2 / §3.7 / §5.2 (ADR-0063 §8.1 row 6), the geometry of a card in the bubble:
// - a card with no picture (layout `no_image`: a generic page with no image, a brand shell with no
//   bundled icon, a payment shell) has the link glyph at its end, like the plain-link card;
// - a picture whose size is unknown decides `no_image` in rust/links, so it is not drawn at all (it
//   used to fall into the old 72px thumbnail beside the text);
// - the sub line and the domain line are one line each on a card; without a registry the preview
//   stays as Signal draws it;
// - a large-image card's picture is 1.91:1 at its widest and square at its tallest;
// - a Tellomi user's avatar is 56px (§5.2).
// These run the real selector (`getPropsForBubble`) over the real rust/links and draw the result
// with the real message component.

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<
    Readonly<{ name: string; preview: string; body: string; card: string }>
  >;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

const FRIEND = getDefaultConversation({ id: 'friend' });

const PAGE = 'https://www.163.com/news/article/K1234.html';
const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';
const TAOBAO = 'https://item.taobao.com/item.htm?id=100032608854';
const ALIPAY = 'https://render.alipay.com/p/f/fd-j5rqp49m/index.html';
const USER_LINK = 'https://tell.cc/kaixin.57';
const GROUP_LINK = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CALL_LINK =
  'https://signal.link/call/#key=hzcn-pcff-ctsc-bdbf-stcr-tzpc-bhqx-kghh';
const STICKER_PACK_LINK =
  'https://signal.art/addstickers/#pack_id=0123456789abcdef0123456789abcdef&pack_key=abababababababababababababababababababababababababababababababab';

// The rich bytes of a golden case, as Desktop stores them.
function goldenRich(name: string): string {
  const found = golden.classify.find(testCase => testCase.name === name);
  assert.isDefined(found, name);
  const preview: Readonly<{ rich?: string }> = JSON.parse(
    found?.preview ?? '{}'
  );
  assert.isDefined(preview.rich, name);
  return Bytes.toBase64(Bytes.fromHex(preview.rich ?? ''));
}

const STRUCTURED_RICH = goldenRich(
  'structured video: sender level 2, required fields present'
);
const TAOBAO_RICH = goldenRich(
  '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs'
);
const ALIPAY_RICH = goldenRich('payment platform: brand, locked, never tinted');
const GROUP_RICH = goldenRich(
  'group: name from the snapshot, member count from a rich that agrees'
);

type ImageSize = Readonly<{ width?: number; height?: number }>;

type PreviewInput = Readonly<{
  url: string;
  title?: string;
  rich?: string;
  // The picture of the preview: its size as the sender's pointer declared it (none = unknown).
  image?: ImageSize;
}>;

function options(conversation: ConversationType): GetPropsForBubbleOptions {
  return {
    accountSelector: () => undefined,
    activeCall: undefined,
    callHistorySelector: () => undefined,
    callSelector: () => undefined,
    contactNameColors: new Map(),
    conversationSelector: (id?: string) =>
      id === conversation.id ? conversation : getDefaultConversation(),
    defaultConversationColor: { color: 'ultramarine' },
    getStoryReplyAttachment: () => undefined,
    hasMediaBackups: false,
    ourAci: undefined,
    ourConversationId: 'us',
    ourNumber: undefined,
    ourPni: undefined,
    pinnedMessagesMessageIds: null,
    regionCode: 'US',
    selectedMessageIds: undefined,
  };
}

function message(
  body: string,
  preview: PreviewInput | undefined
): MessageWithUIFieldsType {
  const timestamp = 1_700_000_000_000;
  const attributes: Partial<MessageAttributesType> = {
    id: `message-${Math.random()}`,
    conversationId: FRIEND.id,
    type: 'incoming',
    body,
    sent_at: timestamp,
    timestamp,
    received_at: 1,
    received_at_ms: timestamp,
    sourceServiceId: FRIEND.serviceId,
    preview: preview
      ? [
          {
            url: preview.url,
            title: preview.title,
            rich: preview.rich,
            image: preview.image
              ? {
                  contentType: IMAGE_JPEG,
                  size: 10_000,
                  path: 'ab/abcdef',
                  ...preview.image,
                }
              : undefined,
          },
        ]
      : [],
  };
  return attributes as unknown as MessageWithUIFieldsType;
}

function propsOf(
  body: string,
  preview: PreviewInput | undefined
): MessagePropsType {
  const bubble = getPropsForBubble(message(body, preview), options(FRIEND));
  if (bubble.type !== 'message') {
    throw new Error(`expected a message bubble, got ${bubble.type}`);
  }
  return bubble.data;
}

function firstPreview(data: MessagePropsType): LinkPreviewForUIType {
  const [first] = data.previews ?? [];
  if (!first) {
    throw new Error('the message has no card');
  }
  return first;
}

// The card of the bubble as the message component draws it from these props.
function drawCard(data: MessagePropsType): string {
  const view = new Message({
    ...data,
    i18n,
    theme: 'light',
    getLinkCardTint: () => undefined,
  } as never);
  const card = view.renderPreview();
  return card ? renderToStaticMarkup(card) : '';
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

const LINK_ICON = 'module-message__link-preview__link-icon';
const THUMBNAIL = 'module-image__image';
const ICON_IMAGE = 'module-message__link-preview__icon-image';

describe('link card geometry in the bubble', () => {
  const contextConfig = window.SignalContext.config as { installPath?: string };
  let previousInstallPath: string | undefined;
  let savedConversationController: typeof window.ConversationController;

  before(() => {
    // The brand icons ship in the app's build folder: under test that is this checkout.
    previousInstallPath = contextConfig.installPath;
    contextConfig.installPath = cwd();
  });

  after(() => {
    contextConfig.installPath = previousInstallPath;
  });

  beforeEach(() => {
    _setLinkRegistryForTesting(
      LinkRegistry.load(
        new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
      )
    );
    savedConversationController = window.ConversationController;
    window.ConversationController = {
      getOurConversationId: () => 'us',
      isSignalConversationId: () => false,
    } as unknown as typeof window.ConversationController;
  });

  afterEach(() => {
    window.ConversationController = savedConversationController;
    _setLinkRegistryForTesting(undefined);
  });

  describe('a card with no picture has the link glyph at its end (§3.2 no-image card)', () => {
    it('a generic page with no image', () => {
      const data = propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' });
      const preview = firstPreview(data);
      assert.strictEqual(preview.card?.level, 'generic');
      assert.strictEqual(preview.layout, 'no_image');

      const card = drawCard(data);
      assert.strictEqual(count(card, LINK_ICON), 1, 'the link glyph');
      assert.include(card, 'Page title');
      assert.include(card, '163.com');
      assert.notInclude(card, THUMBNAIL);
    });

    it('a brand shell with no bundled icon (a video with no picture falls back to one)', () => {
      const data = propsOf(`look ${BILIBILI}`, {
        url: BILIBILI,
        title: '《柯洁围棋入门课》',
        rich: STRUCTURED_RICH,
      });
      const preview = firstPreview(data);
      // A video needs its picture; without it rust/links has already made a brand shell of it.
      assert.strictEqual(preview.card?.level, 'brand');
      assert.strictEqual(preview.layout, 'no_image');
      assert.strictEqual(count(drawCard(data), LINK_ICON), 1);
    });

    it('a payment shell, which has no icon and is never tinted', () => {
      const data = propsOf(ALIPAY, {
        url: ALIPAY,
        title: '支付宝',
        rich: ALIPAY_RICH,
      });
      const preview = firstPreview(data);
      assert.isTrue(preview.card?.payment);
      assert.strictEqual(preview.layout, 'no_image');

      const card = drawCard(data);
      assert.strictEqual(count(card, LINK_ICON), 1);
      assert.include(card, 'Alipay');
      assert.include(card, 'Web page', 'what the link is');
    });

    it('is still one glyph on the plain-link card', () => {
      const data = propsOf(PAGE, undefined);
      assert.strictEqual(firstPreview(data).card?.level, 'plain_link');
      assert.strictEqual(count(drawCard(data), LINK_ICON), 1);
    });

    it("has no glyph on Signal's own call link and sticker pack cards", () => {
      for (const [link, title] of [
        [CALL_LINK, 'Camping Prep'],
        [STICKER_PACK_LINK, 'Bandit the Cat'],
      ] as const) {
        const data = propsOf(link, { url: link, title });
        const [first] = data.previews ?? [];
        assert.strictEqual(first?.layout, 'no_image', link);
        assert.isTrue(first?.isCallLink || first?.isStickerPack, link);
        assert.notInclude(drawCard(data), LINK_ICON, link);
      }
    });

    it('has no glyph on the other shapes', () => {
      const icon = propsOf(`look ${PAGE}`, {
        url: PAGE,
        title: 'Page title',
        image: { width: 100, height: 100 },
      });
      assert.strictEqual(firstPreview(icon).layout, 'icon');
      let card = drawCard(icon);
      assert.notInclude(card, LINK_ICON);
      assert.include(card, ICON_IMAGE);

      const large = propsOf(`look ${PAGE}`, {
        url: PAGE,
        title: 'Page title',
        image: { width: 1200, height: 630 },
      });
      assert.strictEqual(firstPreview(large).layout, 'large_image');
      card = drawCard(large);
      assert.notInclude(card, LINK_ICON);
      assert.include(card, 'module-image-grid');

      const brand = propsOf(TAOBAO, {
        url: TAOBAO,
        title: '淘宝',
        rich: TAOBAO_RICH,
      });
      assert.strictEqual(firstPreview(brand).layout, 'icon');
      assert.isDefined(firstPreview(brand).cardIcon, 'the bundled icon');
      card = drawCard(brand);
      assert.notInclude(card, LINK_ICON);
      assert.include(card, 'module-message__link-preview__brand-icon');

      for (const link of [USER_LINK, GROUP_LINK]) {
        const firstParty = propsOf(link, { url: link, title: 'Book club' });
        assert.strictEqual(firstPreview(firstParty).layout, 'first_party');
        assert.notInclude(drawCard(firstParty), LINK_ICON, link);
      }
    });
  });

  describe('a picture of unknown size (audit S6)', () => {
    it('decides no_image in rust/links, and the picture is not drawn beside the text', () => {
      const data = propsOf(`look ${PAGE}`, {
        url: PAGE,
        title: 'Page title',
        image: {},
      });
      const preview = firstPreview(data);
      assert.strictEqual(preview.card?.level, 'generic');
      assert.isDefined(preview.image, 'the picture is still there');
      assert.isUndefined(preview.image?.width);
      assert.strictEqual(preview.layout, 'no_image');

      const card = drawCard(data);
      assert.notInclude(card, THUMBNAIL, 'no 72px thumbnail beside the text');
      assert.notInclude(card, '<img');
      assert.strictEqual(count(card, LINK_ICON), 1, 'the no-image card');
      assert.include(card, 'Page title');
    });

    it('is left as Signal draws it without a registry (no decision, no shape)', () => {
      _setLinkRegistryForTesting(undefined);
      const data = propsOf(`look ${PAGE}`, {
        url: PAGE,
        title: 'Page title',
        image: { width: 100, height: 100 },
      });
      const preview = firstPreview(data);
      assert.isUndefined(preview.card);
      assert.isUndefined(preview.layout);

      const card = drawCard(data);
      assert.include(card, THUMBNAIL, "Signal's thumbnail beside the text");
      assert.notInclude(card, LINK_ICON);
    });
  });

  describe('the sub line and the domain line are one line each (audit A20)', () => {
    const SUB_LINE = 'module-message__link-preview__description--one-line';
    const DOMAIN_LINE = 'module-message__link-preview__footer--one-line';

    it('on a structured card', () => {
      const data = propsOf(`look ${BILIBILI}`, {
        url: BILIBILI,
        title: '《柯洁围棋入门课》',
        rich: STRUCTURED_RICH,
        image: { width: 1200, height: 630 },
      });
      assert.strictEqual(firstPreview(data).card?.level, 'structured');
      const card = drawCard(data);
      assert.include(card, SUB_LINE);
      assert.include(card, DOMAIN_LINE);
    });

    it('on a brand shell and a generic card', () => {
      const brand = drawCard(
        propsOf(TAOBAO, { url: TAOBAO, title: '淘宝', rich: TAOBAO_RICH })
      );
      assert.include(brand, SUB_LINE, 'what the link is');
      assert.include(brand, DOMAIN_LINE);

      const generic = drawCard(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      assert.notInclude(generic, SUB_LINE, 'a generic card has no sub line');
      assert.include(generic, DOMAIN_LINE);
    });

    it('but not on a preview without a decision, which keeps the upstream look', () => {
      _setLinkRegistryForTesting(undefined);
      const card = drawCard(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      assert.notInclude(card, SUB_LINE);
      assert.notInclude(card, DOMAIN_LINE);
      assert.include(card, 'module-message__link-preview__footer');
    });
  });

  describe("a large-image card's picture is between 1.91:1 and square (audit B3)", () => {
    // `width:…px;height:…px` of the picture's box, as the component draws it.
    function pictureBox(markup: string): string | undefined {
      return /class="module-image(?: [^"]*)?"[^>]*style="(width:\d+px;height:\d+px)/.exec(
        markup
      )?.[1];
    }

    function large(image: ImageSize): string {
      const data = propsOf(`look ${PAGE}`, {
        url: PAGE,
        title: 'Page title',
        image,
      });
      assert.strictEqual(firstPreview(data).layout, 'large_image');
      return drawCard(data);
    }

    it('crops a very wide picture to 1.91:1', () => {
      assert.strictEqual(
        pictureBox(large({ width: 1800, height: 600 })),
        'width:300px;height:157px'
      );
      // 6:1: the narrowest shape the layout function still calls a large image.
      assert.strictEqual(
        pictureBox(large({ width: 3600, height: 600 })),
        'width:300px;height:157px'
      );
    });

    it('crops a tall picture to square', () => {
      assert.strictEqual(
        pictureBox(large({ width: 600, height: 1200 })),
        'width:300px;height:300px'
      );
    });

    it('draws a picture inside the range as it is', () => {
      assert.strictEqual(
        pictureBox(large({ width: 1200, height: 630 })),
        'width:300px;height:158px'
      );
      assert.strictEqual(
        pictureBox(large({ width: 900, height: 600 })),
        'width:300px;height:200px'
      );
    });
  });

  describe("a Tellomi user's avatar is 56px (audit A12)", () => {
    const avatarBox = (markup: string): string | undefined =>
      /class="module-Avatar[^"]*"[^>]*style="(min-width:\d+px;width:\d+px;height:\d+px)"/.exec(
        markup
      )?.[1];

    it('on the user card', () => {
      const data = propsOf(USER_LINK, { url: USER_LINK });
      assert.strictEqual(firstPreview(data).card?.first_party?.type, 'user');
      assert.strictEqual(
        avatarBox(drawCard(data)),
        'min-width:56px;width:56px;height:56px'
      );
    });

    it('not on the group card, which the spec gives no size', () => {
      const data = propsOf(GROUP_LINK, {
        url: GROUP_LINK,
        title: 'Book club',
        rich: GROUP_RICH,
      });
      assert.strictEqual(firstPreview(data).card?.first_party?.type, 'group');
      assert.strictEqual(
        avatarBox(drawCard(data)),
        'min-width:52px;width:52px;height:52px'
      );
    });
  });
});
