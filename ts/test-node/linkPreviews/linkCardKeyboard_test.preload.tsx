// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
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
import i18n from '../util/i18n.node.ts';

// card-visual §3.6 and the brief for this wave: what a screen reader and the keyboard get from a
// link card in the bubble.
// - a link card is one link: `role="link"`, focusable, named "Link, <title>, <domain>"; Enter and
//   Space open it, Space without scrolling the page (audit S5: the code compared `event.key` with
//   "Space", which no key produces, so only Enter ever worked);
// - a Tellomi object's card is a group named as one sentence ("Tellomi group, <name>, <members>,
//   button: Join Group") whose pieces are not read again, with one real button, the action row:
//   `role="button"`, focusable, Enter and Space open the link;
// - a card that cannot be opened (a message request) is text, with no role and no name.
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
const STRANGER = getDefaultConversation({
  id: 'stranger',
  acceptedMessageRequest: false,
});

const PAGE = 'https://www.163.com/news/article/K1234.html';
const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';
const TAOBAO = 'https://item.taobao.com/item.htm?id=100032608854';
const USER_LINK = 'https://tell.cc/kaixin.57';
const GROUP_LINK = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CALL_LINK =
  'https://tell.cc/call/#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';
const STICKER_LINK =
  'https://tell.cc/s#pack_id=00000000000000000000000000000000&pack_key=0000000000000000000000000000000000000000000000000000000000000000';
const OFFICIAL_LINK = 'https://tellomi.app/security';

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
const GROUP_RICH = goldenRich(
  'group: name from the snapshot, member count from a rich that agrees'
);

type PreviewInput = Readonly<{
  url: string;
  title?: string;
  rich?: string;
  withImage?: boolean;
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
  conversation: ConversationType,
  body: string,
  preview: PreviewInput | undefined
): MessageWithUIFieldsType {
  const timestamp = 1_700_000_000_000;
  const attributes: Partial<MessageAttributesType> = {
    id: `message-${Math.random()}`,
    conversationId: conversation.id,
    type: 'incoming',
    body,
    sent_at: timestamp,
    timestamp,
    received_at: 1,
    received_at_ms: timestamp,
    sourceServiceId: conversation.serviceId,
    preview: preview
      ? [
          {
            url: preview.url,
            title: preview.title,
            rich: preview.rich,
            image: preview.withImage
              ? {
                  contentType: 'image/jpeg' as never,
                  size: 10_000,
                  path: 'ab/abcdef',
                  width: 1200,
                  height: 630,
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
  preview: PreviewInput | undefined,
  conversation: ConversationType = FRIEND
): MessagePropsType {
  const bubble = getPropsForBubble(
    message(conversation, body, preview),
    options(conversation)
  );
  if (bubble.type !== 'message') {
    throw new Error(`expected a message bubble, got ${bubble.type}`);
  }
  return bubble.data;
}

type Props = Record<string, unknown>;

// The card of the bubble, as the element the message component makes of these props.
function cardElement(data: MessagePropsType): ReactElement<Props> {
  const view = new Message({
    ...data,
    i18n,
    theme: 'light',
    getLinkCardTint: () => undefined,
  } as never);
  const card = view.renderPreview();
  if (!card) {
    throw new Error('no card');
  }
  return card;
}

function drawCard(data: MessagePropsType): string {
  return renderToStaticMarkup(cardElement(data));
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

const FIRST_PARTY_ACTION = 'module-message__link-preview__first-party-action';
// The row of the picture and the text.
const FIRST_PARTY_CONTENT = 'module-message__link-preview__content';

// The opening tag, attributes and all, of the first element with this class.
function tagWith(markup: string, className: string): string {
  const match = new RegExp(
    `<[a-z]+ [^>]*class="[^"]*${className}[^"]*"[^>]*>`
  ).exec(markup);
  if (!match) {
    throw new Error(`no element with class ${className} in ${markup}`);
  }
  return match[0];
}

// The first element of the tree (as the component made it, not as it renders) that `test` accepts.
function findElement(
  node: ReactNode,
  test: (props: Props) => boolean
): ReactElement<Props> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, test);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isValidElement<Props>(node)) {
    return undefined;
  }
  if (test(node.props)) {
    return node;
  }
  return findElement(node.props.children as ReactNode, test);
}

type FakeKeyEvent = Readonly<{
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}>;

function press(
  handler: unknown,
  key: string
): { defaultPrevented: boolean; stopped: boolean } {
  const seen = { defaultPrevented: false, stopped: false };
  const event: FakeKeyEvent = {
    key,
    preventDefault: () => {
      seen.defaultPrevented = true;
    },
    stopPropagation: () => {
      seen.stopped = true;
    },
  };
  (handler as (event: FakeKeyEvent) => void)(event);
  return seen;
}

describe('link card: screen reader name, role and keyboard', () => {
  const contextConfig = window.SignalContext.config as { installPath?: string };
  let previousInstallPath: string | undefined;
  let savedConversationController: typeof window.ConversationController;
  let savedLocation: PropertyDescriptor | undefined;

  before(() => {
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
    // `openLinkInWebBrowser` navigates the window; the app's main process catches it.
    savedLocation = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (savedLocation) {
      Object.defineProperty(window, 'location', savedLocation);
    } else {
      Reflect.deleteProperty(window, 'location');
    }
    window.ConversationController = savedConversationController;
    _setLinkRegistryForTesting(undefined);
  });

  describe('a link card (third party)', () => {
    it('is a focusable link named "Link, title, domain"', () => {
      const cases: ReadonlyArray<
        Readonly<[string, PreviewInput | undefined, string]>
      > = [
        [
          `look ${PAGE}`,
          { url: PAGE, title: 'Page title' },
          'Link, Page title, 163.com',
        ],
        [
          `look ${BILIBILI}`,
          {
            url: BILIBILI,
            title: '《柯洁围棋入门课》',
            rich: STRUCTURED_RICH,
            withImage: true,
          },
          // The sub line (author, length) and the date are not part of the name.
          'Link, 《柯洁围棋入门课》, bilibili.com',
        ],
        [
          TAOBAO,
          { url: TAOBAO, title: '淘宝', rich: TAOBAO_RICH },
          'Link, Taobao, taobao.com',
        ],
        [PAGE, undefined, 'Link, 163.com'],
      ];
      for (const [body, preview, label] of cases) {
        const card = drawCard(propsOf(body, preview));
        assert.include(card, 'role="link"', label);
        assert.include(card, 'tabindex="0"', label);
        assert.include(card, `aria-label="${label}"`, label);
      }
    });

    it('is named from the preview as Signal draws it without a registry', () => {
      _setLinkRegistryForTesting(undefined);
      const card = drawCard(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      assert.include(card, 'role="link"');
      assert.include(card, 'aria-label="Link, Page title, www.163.com"');
    });

    it('opens on Enter and on Space, and Space does not scroll the page', () => {
      const element = cardElement(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      const onKeyDown = element.props.onKeyDown;
      assert.isFunction(onKeyDown);

      for (const key of ['Enter', ' ']) {
        window.location.href = '';
        const seen = press(onKeyDown, key);
        assert.strictEqual(window.location.href, PAGE, JSON.stringify(key));
        assert.isTrue(seen.defaultPrevented, `${JSON.stringify(key)} default`);
        assert.isTrue(seen.stopped, `${JSON.stringify(key)} bubbling`);
      }
    });

    it('does nothing on any other key', () => {
      const element = cardElement(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      for (const key of ['Tab', 'a', 'Escape', 'ArrowDown', 'Shift']) {
        window.location.href = '';
        const seen = press(element.props.onKeyDown, key);
        assert.strictEqual(window.location.href, '', key);
        assert.isFalse(seen.defaultPrevented, key);
        assert.isFalse(seen.stopped, key);
      }
    });

    it('opens on a click, as before', () => {
      const element = cardElement(
        propsOf(`look ${PAGE}`, { url: PAGE, title: 'Page title' })
      );
      const seen = press(element.props.onClick, 'click');
      assert.strictEqual(window.location.href, PAGE);
      assert.isTrue(seen.defaultPrevented);
    });
  });

  describe('the card of a link that cannot be opened (message request)', () => {
    it('has no role, no name and is not focusable', () => {
      const data = propsOf(
        `look ${PAGE}`,
        { url: PAGE, title: 'Sender title' },
        STRANGER
      );
      assert.isFalse(data.isMessageRequestAccepted);
      const card = drawCard(data);
      assert.notInclude(card, 'role=');
      assert.notInclude(card, 'aria-label');
      assert.notInclude(card, 'tabindex');
    });
  });

  describe('the card of a Tellomi object (first party)', () => {
    type Case = Readonly<{
      name: string;
      link: string;
      preview: PreviewInput;
      label: string;
    }>;
    const CASES: ReadonlyArray<Case> = [
      {
        name: 'group',
        link: GROUP_LINK,
        preview: { url: GROUP_LINK, title: 'Book club', rich: GROUP_RICH },
        label: 'Tellomi group, Book club, 12 members, button: Join Group',
      },
      {
        name: 'user',
        link: USER_LINK,
        preview: { url: USER_LINK },
        label: 'Tellomi user, @kaixin.57, button: Message',
      },
      {
        name: 'call',
        link: CALL_LINK,
        preview: { url: CALL_LINK, title: 'Camping Prep' },
        label: 'Tellomi call, Camping Prep, button: Join Call',
      },
      {
        name: 'sticker pack',
        link: STICKER_LINK,
        preview: { url: STICKER_LINK, title: 'Bandit the Cat' },
        label: 'Tellomi sticker pack, Bandit the Cat, button: Add',
      },
      {
        name: 'official site',
        link: OFFICIAL_LINK,
        preview: { url: OFFICIAL_LINK, title: 'Whatever the sender wrote' },
        label: 'Tellomi website, /security, button: Open',
      },
    ];

    for (const testCase of CASES) {
      describe(testCase.name, () => {
        const data = (): MessagePropsType =>
          propsOf(testCase.link, testCase.preview);

        it('is a group named as one sentence, and is not itself focusable', () => {
          const card = drawCard(data());
          assert.include(card, 'role="group"');
          assert.include(card, `aria-label="${testCase.label}"`);
          assert.notInclude(card, 'role="link"');
          // The only tab stop is the action row.
          assert.strictEqual(count(card, 'tabindex'), 1, card);
        });

        it('has one button, the action row, which is focusable', () => {
          const card = drawCard(data());
          assert.strictEqual(count(card, 'role="button"'), 1);
          const row = tagWith(card, FIRST_PARTY_ACTION);
          assert.include(row, 'role="button"');
          assert.include(row, 'tabindex="0"');
          assert.notInclude(row, 'aria-hidden');
        });

        it('does not read its pieces again: the picture and the text are hidden, the button is not', () => {
          const card = drawCard(data());
          assert.include(
            tagWith(card, FIRST_PARTY_CONTENT),
            'aria-hidden="true"'
          );
          assert.notInclude(tagWith(card, FIRST_PARTY_ACTION), 'aria-hidden');
        });

        it('opens from the action row on Enter and on Space, and Space does not scroll', () => {
          const element = cardElement(data());
          const row = findElement(element, props => props.role === 'button');
          assert.isDefined(row);
          const onKeyDown = row?.props.onKeyDown;
          assert.isFunction(onKeyDown);

          for (const key of ['Enter', ' ']) {
            window.location.href = '';
            const seen = press(onKeyDown, key);
            assert.strictEqual(
              window.location.href,
              testCase.link,
              JSON.stringify(key)
            );
            assert.isTrue(
              seen.defaultPrevented,
              `${JSON.stringify(key)} default`
            );
            assert.isTrue(seen.stopped, `${JSON.stringify(key)} bubbling`);
          }

          window.location.href = '';
          const other = press(onKeyDown, 'Tab');
          assert.strictEqual(window.location.href, '');
          assert.isFalse(other.defaultPrevented);
        });

        it('still opens from a click anywhere on the card', () => {
          const element = cardElement(data());
          press(element.props.onClick, 'click');
          assert.strictEqual(window.location.href, testCase.link);
        });
      });
    }

    it('is plain text in a message request, as before', () => {
      const card = drawCard(
        propsOf(GROUP_LINK, { url: GROUP_LINK, title: 'Book club' }, STRANGER)
      );
      assert.notInclude(card, 'role=');
      assert.notInclude(card, 'aria-label');
      assert.notInclude(card, 'tabindex');
    });
  });
});
