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
import { shouldTintLinkCard } from '../../linkPreviews/linkCardVisual.std.ts';
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
import type { LocalizerType } from '../../types/Util.std.ts';

// card-visual §3.3 and §7.3 last paragraph, ADR-0063 §8.1 row 6: in a message request (a
// conversation that has not accepted the request) the card of a stranger's link is the domain
// card: a link glyph and the registrable domain rust/links computes from the URL, nothing the
// sender wrote, not tinted, not clickable, no picture, and the link text in the body stays.
// Accepting the request brings back the full card. These run the real selector
// (`getPropsForBubble`, the function the timeline calls) over the real rust/links, and draw the
// result with the real message component.

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<
    Readonly<{ name: string; preview: string; body: string; card: string }>
  >;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

const SENDER = getDefaultConversation({
  id: 'sender',
  acceptedMessageRequest: false,
});
const FRIEND = getDefaultConversation({ id: 'friend' });

const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';
const TAOBAO = 'https://item.taobao.com/item.htm?id=100032608854';
const ALIPAY = 'https://render.alipay.com/p/f/fd-j5rqp49m/index.html';
const GROUP_LINK = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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

const IMAGE = {
  contentType: IMAGE_JPEG,
  size: 10_000,
  path: 'ab/abcdef',
  width: 1200,
  height: 630,
} as const;

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

type PreviewInput = Readonly<{
  url: string;
  title?: string;
  description?: string;
  rich?: string;
  withImage?: boolean;
}>;

function message({
  body,
  conversationId,
  type = 'incoming',
  previews = [],
}: Readonly<{
  body: string;
  conversationId: string;
  type?: 'incoming' | 'outgoing';
  previews?: ReadonlyArray<PreviewInput>;
}>): MessageWithUIFieldsType {
  const timestamp = 1_700_000_000_000;
  const attributes: Partial<MessageAttributesType> = {
    id: `message-${Math.random()}`,
    conversationId,
    type,
    body,
    sent_at: timestamp,
    timestamp,
    received_at: 1,
    received_at_ms: timestamp,
    sourceServiceId: SENDER.serviceId,
    preview: previews.map(preview => ({
      url: preview.url,
      title: preview.title,
      description: preview.description,
      rich: preview.rich,
      image: preview.withImage ? { ...IMAGE } : undefined,
    })),
  };
  return attributes as unknown as MessageWithUIFieldsType;
}

function props(
  conversation: ConversationType,
  incoming: MessageWithUIFieldsType
): MessagePropsType {
  const bubble = getPropsForBubble(incoming, options(conversation));
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

// The card and the text of the bubble as the message component draws them from these props.
function draw(data: MessagePropsType): {
  card: string;
  text: string | undefined;
} {
  const i18n = Object.assign((key: string) => `[${key}]`, {
    getLocale: () => 'en',
  }) as unknown as LocalizerType;
  const view = new Message({
    ...data,
    i18n,
    theme: 'light',
    getLinkCardTint: () => undefined,
  } as never);
  const card = view.renderPreview();
  const text = view.renderText();
  return {
    card: card ? renderToStaticMarkup(card) : '',
    text: text ? renderToStaticMarkup(text) : undefined,
  };
}

describe('card of a link in a message request', () => {
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
    // The selector asks the global controller two questions about our own conversations.
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

  describe('in an accepted conversation (control)', () => {
    it('shows the full card: the sender title, the picture, the icon, the first-party details', () => {
      const generic = firstPreview(
        props(
          FRIEND,
          message({
            body: `look ${BILIBILI}`,
            conversationId: FRIEND.id,
            previews: [
              { url: BILIBILI, title: 'Sender title', withImage: true },
            ],
          })
        )
      );
      assert.strictEqual(generic.card?.level, 'generic');
      assert.strictEqual(generic.title, 'Sender title');
      assert.isDefined(generic.image);
      assert.isDefined(generic.layout);
      assert.isTrue(generic.card?.tintable);

      const brand = firstPreview(
        props(
          FRIEND,
          message({
            body: TAOBAO,
            conversationId: FRIEND.id,
            previews: [
              {
                url: TAOBAO,
                title: '淘宝',
                rich: TAOBAO_RICH,
                withImage: true,
              },
            ],
          })
        )
      );
      assert.strictEqual(brand.card?.level, 'brand');
      assert.strictEqual(brand.card?.provider, 'taobao');
      assert.isDefined(brand.cardIcon, 'the bundled icon is read');

      const group = firstPreview(
        props(
          FRIEND,
          message({
            body: GROUP_LINK,
            conversationId: FRIEND.id,
            previews: [{ url: GROUP_LINK, title: 'Book club' }],
          })
        )
      );
      assert.strictEqual(group.card?.level, 'first_party');
      assert.deepEqual(group.card?.first_party, {
        type: 'group',
        title: 'Book club',
        member_count: null,
      });
    });

    it('hides the link text of a message that is just a link, as before', () => {
      const data = props(
        FRIEND,
        message({
          body: BILIBILI,
          conversationId: FRIEND.id,
          previews: [{ url: BILIBILI, title: 'Sender title' }],
        })
      );
      assert.isTrue(data.isMessageRequestAccepted);
      assert.isTrue(data.isLinkCardOnly);
      const drawn = draw(data);
      assert.include(drawn.card, 'role="link"', 'clickable');
      assert.include(drawn.card, 'Sender title');
      assert.isUndefined(drawn.text, 'no link text under the card');
    });
  });

  describe('in a message request', () => {
    it('shows a generic preview as the domain card and nothing the sender wrote', () => {
      const data = props(
        SENDER,
        message({
          body: `look ${BILIBILI}`,
          conversationId: SENDER.id,
          previews: [
            {
              url: BILIBILI,
              title: 'Sender title',
              description: 'Sender description',
              withImage: true,
            },
          ],
        })
      );
      assert.isFalse(data.isMessageRequestAccepted);
      assert.lengthOf(data.previews ?? [], 1);
      const preview = firstPreview(data);

      assert.strictEqual(preview.card?.level, 'plain_link');
      assert.strictEqual(preview.card?.domain, 'bilibili.com');
      assert.strictEqual(preview.domain, 'bilibili.com');
      assert.isFalse(preview.card?.tintable, 'never tinted');
      assert.isFalse(preview.card?.show_image);
      assert.isNull(preview.card?.title);
      assert.isNull(preview.card?.description);
      assert.deepEqual(preview.card?.attrs, []);
      assert.isNull(preview.card?.first_party);
      assert.isFalse(preview.card?.official_badge);
      assert.isNull(preview.card?.provider);
      assert.isNull(preview.card?.kind);

      // Nothing of the preview is passed on: no text, no picture, no shape, no icon.
      assert.isUndefined(preview.title);
      assert.isUndefined(preview.description);
      assert.isUndefined(preview.image);
      assert.isUndefined(preview.cardIcon);
      assert.isUndefined(preview.layout);
      assert.isUndefined(preview.date);
      assert.isUndefined(preview.rich);
      assert.isFalse(preview.isStickerPack);
      assert.isFalse(preview.isCallLink);
      assert.strictEqual(preview.url, BILIBILI);
    });

    it('is drawn as the domain and a link glyph: not clickable, not tinted, no picture', () => {
      const drawn = draw(
        props(
          SENDER,
          message({
            body: `look ${BILIBILI}`,
            conversationId: SENDER.id,
            previews: [
              {
                url: BILIBILI,
                title: 'Sender title',
                description: 'Sender description',
                withImage: true,
              },
            ],
          })
        )
      );
      assert.include(drawn.card, 'module-message__link-preview--nonclickable');
      assert.notInclude(drawn.card, 'role="link"');
      assert.notInclude(drawn.card, 'tabindex');
      assert.include(
        drawn.card,
        '<div class="module-message__link-preview__title">bilibili.com</div>'
      );
      assert.include(drawn.card, 'module-message__link-preview__link-icon');
      assert.notInclude(drawn.card, '<img');
      assert.notInclude(drawn.card, 'Sender title');
      assert.notInclude(drawn.card, 'Sender description');
      assert.notInclude(drawn.card, 'module-message__link-preview__icon-image');
      assert.notInclude(
        drawn.card,
        'module-message__link-preview__description'
      );
      assert.notInclude(
        drawn.card,
        'module-message__link-preview--flush-bottom'
      );
    });

    it('is never tinted, whatever the layout would be', () => {
      const preview = firstPreview(
        props(
          SENDER,
          message({
            body: BILIBILI,
            conversationId: SENDER.id,
            previews: [
              { url: BILIBILI, title: 'Sender title', withImage: true },
            ],
          })
        )
      );
      for (const layout of ['icon', 'large_image', 'no_image'] as const) {
        assert.isFalse(
          shouldTintLinkCard({
            card: preview.card,
            layout,
            isMessageRequest: false,
          }),
          layout
        );
      }
    });

    it('shows a structured card (rich content) as the domain card', () => {
      const preview = firstPreview(
        props(
          SENDER,
          message({
            body: BILIBILI,
            conversationId: SENDER.id,
            previews: [
              {
                url: BILIBILI,
                title: '《柯洁围棋入门课》',
                rich: STRUCTURED_RICH,
                withImage: true,
              },
            ],
          })
        )
      );
      assert.strictEqual(preview.card?.level, 'plain_link');
      assert.isNull(preview.card?.provider);
      assert.isNull(preview.card?.kind);
      assert.deepEqual(preview.card?.attrs, []);
      assert.strictEqual(preview.card?.domain, 'bilibili.com');
      assert.isUndefined(preview.rich);
      assert.isUndefined(preview.image);
    });

    it('shows a brand shell as the domain card, without its bundled icon or platform name', () => {
      const data = props(
        SENDER,
        message({
          body: TAOBAO,
          conversationId: SENDER.id,
          previews: [
            { url: TAOBAO, title: '淘宝', rich: TAOBAO_RICH, withImage: true },
          ],
        })
      );
      const preview = firstPreview(data);
      assert.strictEqual(preview.card?.level, 'plain_link');
      assert.isNull(preview.card?.provider);
      assert.isNull(preview.card?.provider_name);
      assert.isNull(preview.card?.icon ?? null);
      assert.strictEqual(preview.card?.domain, 'taobao.com');
      assert.isUndefined(preview.cardIcon);
      assert.isUndefined(preview.layout);
      const drawn = draw(data);
      assert.notInclude(drawn.card, '<img');
      assert.notInclude(drawn.card, '淘宝');
      assert.notInclude(drawn.card, 'TellomiLinkCard__kind_');
    });

    it('shows a payment shell as the domain card too', () => {
      const preview = firstPreview(
        props(
          SENDER,
          message({
            body: ALIPAY,
            conversationId: SENDER.id,
            previews: [{ url: ALIPAY, title: '支付宝' }],
          })
        )
      );
      assert.strictEqual(preview.card?.level, 'plain_link');
      assert.strictEqual(preview.card?.domain, 'alipay.com');
      assert.isFalse(preview.card?.payment);
      assert.isFalse(preview.card?.tintable);
    });

    it('shows first-party links as the domain card: no avatar, group name, sticker name or badge', () => {
      const cases: ReadonlyArray<
        Readonly<{ url: string; title?: string; domain: string }>
      > = [
        { url: 'https://tell.cc/kaixin', title: '@kefu', domain: 'tell.cc' },
        { url: GROUP_LINK, title: 'Book club', domain: 'tell.cc' },
        {
          url: 'https://tell.cc/s#pack_id=00000000000000000000000000000000&pack_key=0000000000000000000000000000000000000000000000000000000000000000',
          title: 'Cats',
          domain: 'tell.cc',
        },
        {
          url: 'https://tell.cc/call/#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz',
          title: 'Standup',
          domain: 'tell.cc',
        },
        {
          url: 'https://tellomi.app/security',
          title: 'Tellomi',
          domain: 'tellomi.app',
        },
      ];
      for (const { url, title, domain } of cases) {
        const data = props(
          SENDER,
          message({
            body: url,
            conversationId: SENDER.id,
            previews: [{ url, title, withImage: true }],
          })
        );
        const preview = firstPreview(data);
        assert.strictEqual(preview.card?.level, 'plain_link', url);
        assert.strictEqual(preview.card?.domain, domain, url);
        assert.isNull(preview.card?.first_party, url);
        assert.isFalse(preview.card?.official_badge, url);
        assert.isNull(preview.card?.kind, url);
        assert.isFalse(preview.isStickerPack, url);
        assert.isFalse(preview.isCallLink, url);
        assert.isUndefined(preview.image, url);
        assert.isUndefined(preview.firstPartyLocal, url);
        const drawn = draw(data);
        assert.notInclude(drawn.card, 'first-party', url);
        assert.notInclude(drawn.card, 'TellomiLinkCard__', url);
      }
    });

    it('keeps the imitation warning of a lookalike domain, with or without other text', () => {
      const url = 'https://www.bi1ibili.com/video/BV1YDhJ6ZEL6';
      for (const body of [url, `look ${url}`]) {
        const data = props(
          SENDER,
          message({
            body,
            conversationId: SENDER.id,
            previews: [{ url, title: 'Sender title' }],
          })
        );
        const preview = firstPreview(data);
        assert.strictEqual(preview.card?.level, 'plain_link');
        assert.strictEqual(preview.card?.domain, 'bi1ibili.com');
        assert.strictEqual(preview.card?.lookalike, 'bilibili.com');
        assert.include(
          draw(data).card,
          'module-message__link-preview__title--lookalike'
        );
      }
    });

    it('keeps the link text of a message that is just a link', () => {
      const withPreview = props(
        SENDER,
        message({
          body: BILIBILI,
          conversationId: SENDER.id,
          previews: [{ url: BILIBILI, title: 'Sender title' }],
        })
      );
      assert.isFalse(withPreview.isLinkCardOnly, 'the body text stays');
      assert.strictEqual(withPreview.text, BILIBILI);
      assert.strictEqual(
        firstPreview(withPreview).card?.domain,
        'bilibili.com'
      );
      const drawnWithPreview = draw(withPreview);
      assert.isDefined(drawnWithPreview.text);
      assert.include(drawnWithPreview.text, BILIBILI);
      assert.notInclude(drawnWithPreview.text, '<a ', 'the link is not live');

      // No preview at all: the card of the URL alone, and the text stays too.
      const withoutPreview = props(
        SENDER,
        message({ body: BILIBILI, conversationId: SENDER.id })
      );
      assert.isFalse(withoutPreview.isLinkCardOnly);
      assert.strictEqual(withoutPreview.text, BILIBILI);
      const plain = firstPreview(withoutPreview);
      assert.strictEqual(plain.card?.level, 'plain_link');
      assert.strictEqual(plain.card?.domain, 'bilibili.com');
      assert.include(draw(withoutPreview).text, BILIBILI);
    });

    it('draws no card when there is no link, or when the preview is of another link', () => {
      assert.deepEqual(
        props(
          SENDER,
          message({ body: 'no link here', conversationId: SENDER.id })
        ).previews,
        []
      );
      // The preview names a site the text does not: nothing to show a domain for.
      assert.deepEqual(
        props(
          SENDER,
          message({
            body: 'https://evil.example.org/x',
            conversationId: SENDER.id,
            previews: [{ url: BILIBILI, title: 'Sender title' }],
          })
        ).previews,
        []
      );
    });

    it('draws no card without a registry: the text stays and no sender text is shown', () => {
      _setLinkRegistryForTesting(undefined);
      // The bundled registry is not there under test, so nothing can be loaded either.
      const data = props(
        SENDER,
        message({
          body: BILIBILI,
          conversationId: SENDER.id,
          previews: [{ url: BILIBILI, title: 'Sender title', withImage: true }],
        })
      );
      assert.deepEqual(data.previews, []);
      assert.isFalse(data.isLinkCardOnly);
      const drawn = draw(data);
      assert.strictEqual(drawn.card, '');
      assert.include(drawn.text, BILIBILI);
    });

    it('reads nothing but the URL of the preview: not the picture, not the text, not rich', () => {
      const reads = new Set<string | symbol>();
      const spy = {
        url: BILIBILI,
        title: 'Sender title',
        description: 'Sender description',
        rich: STRUCTURED_RICH,
        date: 1_700_000_000_000,
        image: new Proxy(
          { ...IMAGE },
          {
            get(target, key) {
              reads.add(`image.${String(key)}`);
              return Reflect.get(target, key);
            },
          }
        ),
      };
      const watched = new Proxy(spy, {
        get(target, key) {
          reads.add(key);
          return Reflect.get(target, key);
        },
      });
      const incoming = message({ body: BILIBILI, conversationId: SENDER.id });
      (incoming as unknown as { preview: Array<unknown> }).preview = [watched];

      const data = props(SENDER, incoming);
      assert.strictEqual(firstPreview(data).card?.domain, 'bilibili.com');
      assert.deepEqual([...reads].map(String), ['url']);
    });
  });

  describe('when the request is accepted', () => {
    it('the same message shows the full card again, and hides the link text again', () => {
      const incoming = (conversation: ConversationType) =>
        message({
          body: BILIBILI,
          conversationId: conversation.id,
          previews: [
            {
              url: BILIBILI,
              title: 'Sender title',
              rich: STRUCTURED_RICH,
              withImage: true,
            },
          ],
        });

      const before = props(SENDER, incoming(SENDER));
      assert.strictEqual(firstPreview(before).card?.level, 'plain_link');
      assert.isFalse(before.isLinkCardOnly);

      const accepted = { ...SENDER, acceptedMessageRequest: true };
      const after = props(accepted, incoming(accepted));
      assert.isTrue(after.isMessageRequestAccepted);
      const preview = firstPreview(after);
      assert.strictEqual(preview.card?.level, 'structured');
      assert.strictEqual(preview.card?.provider, 'bilibili');
      assert.strictEqual(preview.title, 'Sender title');
      assert.isDefined(preview.image);
      assert.isTrue(after.isLinkCardOnly);
    });
  });

  describe('a message of ours', () => {
    it('keeps its full card in a conversation that has not accepted (synced from another device)', () => {
      const data = props(
        SENDER,
        message({
          body: `look ${BILIBILI}`,
          conversationId: SENDER.id,
          type: 'outgoing',
          previews: [{ url: BILIBILI, title: 'Our title' }],
        })
      );
      const preview = firstPreview(data);
      assert.strictEqual(preview.card?.level, 'generic');
      assert.strictEqual(preview.title, 'Our title');
    });
  });
});
