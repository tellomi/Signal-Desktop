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
import type { LinkLocalLookupType } from '../../linkPreviews/firstPartyLocal.node.ts';
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

// card-visual §5.2, row `tellomi.user`: the avatar is a 56 pt circle, "known on this device → the
// real avatar; otherwise the default avatar". The default avatar is the person silhouette, not the
// initials of a title that is "Tellomi user" (a link with no readable name) or the `@name` the link
// carries: neither is a name to draw initials from. A user this device knows is drawn the way the
// rest of the app draws that contact, a picture or else the initials of the name. The other
// first-party cards keep the avatars they had. These run the real selector (`getPropsForBubble`)
// over the real rust/links and draw the result with the real message component.

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<
    Readonly<{ name: string; preview: string; body: string; card: string }>
  >;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

const FRIEND = getDefaultConversation({ id: 'friend' });

// A user with a username (the name is computed from the URL), and two that carry none.
const NICKNAME_LINK = 'https://tell.cc/kaixin.57';
const ENCRYPTED_LINK =
  'https://tell.cc/u#eu/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PHONE_LINK = 'https://tell.cc/u#p/+8613800000007';
const GROUP_LINK = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CALL_LINK =
  'https://tell.cc/call#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';

function goldenRich(name: string): string {
  const found = golden.classify.find(testCase => testCase.name === name);
  assert.isDefined(found, name);
  const preview: Readonly<{ rich?: string }> = JSON.parse(
    found?.preview ?? '{}'
  );
  assert.isDefined(preview.rich, name);
  return Bytes.toBase64(Bytes.fromHex(preview.rich ?? ''));
}

const GROUP_RICH = goldenRich(
  'group: name from the snapshot, member count from a rich that agrees'
);

function options(lookup: LinkLocalLookupType): GetPropsForBubbleOptions {
  return {
    accountSelector: () => undefined,
    activeCall: undefined,
    callHistorySelector: () => undefined,
    callSelector: () => undefined,
    contactNameColors: new Map(),
    conversationSelector: (id?: string) =>
      id === FRIEND.id ? FRIEND : getDefaultConversation(),
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
    linkLocalLookup: lookup,
  };
}

function nobodyKnown(): LinkLocalLookupType {
  return {
    ourAci: undefined,
    getConversationByUsername: () => undefined,
    getConversationByGroupId: () => undefined,
    isStickerPackInstalled: () => false,
  };
}

function knowsUser(
  username: string,
  conversation: ConversationType
): LinkLocalLookupType {
  return {
    ...nobodyKnown(),
    getConversationByUsername: name =>
      name === username ? conversation : undefined,
  };
}

function propsOf(
  url: string,
  lookup: LinkLocalLookupType,
  { title, rich }: { title?: string; rich?: string } = {}
): MessagePropsType {
  const timestamp = 1_700_000_000_000;
  const attributes: Partial<MessageAttributesType> = {
    id: `message-${Math.random()}`,
    conversationId: FRIEND.id,
    type: 'incoming',
    body: url,
    sent_at: timestamp,
    timestamp,
    received_at: 1,
    received_at_ms: timestamp,
    sourceServiceId: FRIEND.serviceId,
    preview: [{ url, title, rich }],
  };
  const bubble = getPropsForBubble(
    attributes as unknown as MessageWithUIFieldsType,
    options(lookup)
  );
  if (bubble.type !== 'message') {
    throw new Error(`expected a message bubble, got ${bubble.type}`);
  }
  return bubble.data;
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
  if (!card) {
    throw new Error('no card');
  }
  return renderToStaticMarkup(card);
}

// The avatar of the card: the box the picture or the initials are drawn in.
function avatarOf(card: string): string {
  const match =
    /<div class="module-message__link-preview__first-party-avatar">(.*?)<\/div><div class="module-message__link-preview__text">/s.exec(
      card
    );
  if (!match?.[1]) {
    throw new Error(`no avatar in ${card}`);
  }
  return match[1];
}

function titleOf(card: string): string | undefined {
  return /<div class="module-message__link-preview__title">([^<]*)</.exec(
    card
  )?.[1];
}

const DEFAULT_PERSON = 'module-Avatar__icon module-Avatar__icon--direct';
const INITIALS = 'module-Avatar__label';
const PICTURE = 'module-Avatar__image';

// The default avatar: the person silhouette, with no initials and no picture. What was drawn is in
// every message, so a failure shows it.
function assertDefaultAvatar(avatar: string, what: string): void {
  assert.include(
    avatar,
    DEFAULT_PERSON,
    `${what}: the silhouette; drawn: ${avatar}`
  );
  assert.notInclude(avatar, INITIALS, `${what}: no initials; drawn: ${avatar}`);
  assert.notInclude(avatar, PICTURE, `${what}: no picture; drawn: ${avatar}`);
}

describe("the avatar on a Tellomi user's link card (card-visual §5.2)", () => {
  let savedConversationController: typeof window.ConversationController;

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

  describe('a user this device does not know', () => {
    it('is the default avatar, not the initials "Tu" of "Tellomi user" (a link with no readable name)', () => {
      for (const link of [ENCRYPTED_LINK, PHONE_LINK]) {
        const card = drawCard(propsOf(link, nobodyKnown()));

        assert.strictEqual(titleOf(card), 'Tellomi user', link);
        const avatar = avatarOf(card);
        assertDefaultAvatar(avatar, link);
        assert.notInclude(avatar, '>Tu<', link);
      }
    });

    it('is the default avatar, not the initial of the @name the link carries', () => {
      const card = drawCard(propsOf(NICKNAME_LINK, nobodyKnown()));

      assert.strictEqual(titleOf(card), '@kaixin.57');
      const avatar = avatarOf(card);
      assertDefaultAvatar(avatar, NICKNAME_LINK);
      assert.notInclude(avatar, '>k<');
    });

    it('is still the 56 pt circle', () => {
      const avatar = avatarOf(drawCard(propsOf(ENCRYPTED_LINK, nobodyKnown())));
      assert.include(avatar, 'style="min-width:56px;width:56px;height:56px"');
    });

    it('is the default avatar for a chat the reader has not accepted, which keeps its name and picture to itself', () => {
      const stranger = getDefaultConversation({
        title: 'Kai Xin',
        avatarUrl: 'file:///stranger.png',
        hasAvatar: true,
        acceptedMessageRequest: false,
      });
      const card = drawCard(
        propsOf(NICKNAME_LINK, knowsUser('kaixin.57', stranger))
      );

      assert.strictEqual(titleOf(card), '@kaixin.57');
      const avatar = avatarOf(card);
      assertDefaultAvatar(avatar, NICKNAME_LINK);
      assert.notInclude(avatar, 'stranger.png');
    });
  });

  describe('a user this device knows', () => {
    it('is their picture', () => {
      const friend = getDefaultConversation({
        title: 'Kai Xin',
        avatarUrl: 'file:///kai-xin.png',
        hasAvatar: true,
        acceptedMessageRequest: true,
      });
      const card = drawCard(
        propsOf(NICKNAME_LINK, knowsUser('kaixin.57', friend))
      );

      assert.strictEqual(titleOf(card), 'Kai Xin');
      const avatar = avatarOf(card);
      assert.include(avatar, PICTURE);
      assert.include(avatar, 'kai-xin.png');
      assert.notInclude(avatar, DEFAULT_PERSON);
      assert.notInclude(avatar, INITIALS);
    });

    it('is the initials of their name when they have no picture, as everywhere else in the app', () => {
      const friend = getDefaultConversation({
        title: 'Kai Xin',
        avatarUrl: undefined,
        hasAvatar: false,
        acceptedMessageRequest: true,
      });
      const card = drawCard(
        propsOf(NICKNAME_LINK, knowsUser('kaixin.57', friend))
      );

      const avatar = avatarOf(card);
      assert.include(avatar, INITIALS);
      assert.include(avatar, '>KX<');
      assert.notInclude(avatar, DEFAULT_PERSON);
    });
  });

  describe('the other first-party cards', () => {
    it('keep the avatars they had: a group its group icon, a call its call-link icon', () => {
      const group = avatarOf(
        drawCard(
          propsOf(GROUP_LINK, nobodyKnown(), {
            title: 'Book club',
            rich: GROUP_RICH,
          })
        )
      );
      assert.include(group, 'module-Avatar__icon module-Avatar__icon--group');
      assert.notInclude(group, INITIALS);

      const call = avatarOf(drawCard(propsOf(CALL_LINK, nobodyKnown())));
      assert.include(call, 'module-Avatar__icon module-Avatar__icon--callLink');
      assert.notInclude(call, INITIALS);
    });
  });
});
