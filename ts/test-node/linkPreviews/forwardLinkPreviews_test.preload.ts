// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import lodash from 'lodash';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

// The reducer first: the ducks import each other, and they only load in this order.
import { reducer as rootReducer } from '../../state/reducer.preload.ts';
import type { StateType } from '../../state/reducer.preload.ts';
import { actions } from '../../state/ducks/globalModals.preload.ts';
import { noopAction } from '../../state/ducks/noop.std.ts';
import * as Bytes from '../../Bytes.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { toOutgoingPreviewProto } from '../../linkPreviews/richContent.std.ts';
import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import { ForwardMessagesModalType } from '../../components/ForwardMessagesModal.dom.tsx';
import { getDefaultConversation } from '../../test-helpers/getDefaultConversation.std.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import type { MessageForwardDraft } from '../../types/ForwardDraft.std.ts';
import { IMAGE_JPEG } from '../../types/MIME.std.ts';
import type { LinkPreviewType } from '../../types/message/LinkPreviews.std.ts';
import { loadPreviewData } from '../../types/Message2.preload.ts';
import { loadData } from '../../util/Attachment.std.ts';

// ADR-0063 §7.4 and §8.1 row 1 (audit S1, M2): forwarding a message sends its link preview on as
// the message has it: `url`, `title`, `description`, `date`, the picture and `rich` (the bytes as
// received, fields this build does not know included). What the message component was given to
// draw it (`card`, `layout`, `cardIcon`, `firstPartyLocal`, the picture's `url`) is for the screen
// only and never goes into a new message; a message that is just a link, or that sits in a
// message request, is drawn from its URL alone, and its title and `rich` must not get lost on the
// way. These run the real "forward" action, the real message selector and the real rust/links.

const { omit } = lodash;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<Readonly<{ name: string; preview: string }>>;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

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

function varint(value: number): Uint8Array<ArrayBuffer> {
  const out: Array<number> = [];
  let rest = value;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return new Uint8Array(out);
}

// A field this build does not know (99, length-delimited), as a newer sender would add it, after
// the fields it does know: the bytes stay as received only if nothing decodes and re-encodes them
// on the way.
const UNKNOWN_PAYLOAD = Bytes.fromString('from a newer client');
const UNKNOWN_FIELD_99 = Bytes.concatenate([
  new Uint8Array([0x9a, 0x06]), // key = 99 << 3 | 2
  varint(UNKNOWN_PAYLOAD.length),
  UNKNOWN_PAYLOAD,
]);

const STRUCTURED_RICH_BYTES = Bytes.concatenate([
  Bytes.fromBase64(
    goldenRich('structured video: sender level 2, required fields present')
  ),
  UNKNOWN_FIELD_99,
]);
const STRUCTURED_RICH = Bytes.toBase64(STRUCTURED_RICH_BYTES);
const TAOBAO_RICH = goldenRich(
  '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs'
);

const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';
const TAOBAO = 'https://item.taobao.com/item.htm?id=100032608854';
const GROUP_LINK = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const IMAGE = {
  contentType: IMAGE_JPEG,
  size: 10_000,
  path: 'ab/abcdef',
  width: 1200,
  height: 630,
  cdnKey: 'the-cdn-key',
  key: 'the-key',
  digest: 'the-digest',
  plaintextHash: 'the-hash',
} as const;

const US = getDefaultConversation({
  id: 'us',
  isMe: true,
  serviceId: generateAci(),
});
const FRIEND = getDefaultConversation({
  id: 'friend',
  serviceId: generateAci(),
});
const STRANGER = getDefaultConversation({
  id: 'stranger',
  serviceId: generateAci(),
  acceptedMessageRequest: false,
});

const TIMESTAMP = 1_700_000_000_000;

function messageWith({
  id,
  conversationId,
  body,
  preview,
}: Readonly<{
  id: string;
  conversationId: string;
  body: string;
  preview?: ReadonlyArray<LinkPreviewType>;
}>): MessageAttributesType {
  return {
    id,
    conversationId,
    type: 'incoming',
    body,
    sent_at: TIMESTAMP,
    timestamp: TIMESTAMP,
    received_at: 1,
    received_at_ms: TIMESTAMP,
    sourceServiceId:
      conversationId === STRANGER.id ? STRANGER.serviceId : FRIEND.serviceId,
    ...(preview ? { preview: [...preview] } : {}),
  } as unknown as MessageAttributesType;
}

function stateWith(...conversations: Array<typeof FRIEND>): StateType {
  const state = rootReducer(undefined, noopAction('forwardLinkPreviews'));
  return {
    ...state,
    conversations: {
      ...state.conversations,
      conversationLookup: Object.fromEntries(
        conversations.map(conversation => [conversation.id, conversation])
      ),
    },
  };
}

// The drafts the "forward" action puts in the modal for these messages, in the order given.
async function forwardDrafts(
  messages: ReadonlyArray<MessageAttributesType>,
  conversations: Array<typeof FRIEND>
): Promise<ReadonlyArray<MessageForwardDraft>> {
  const state = stateWith(US, ...conversations);
  const byId = new Map(messages.map(message => [message.id, message]));
  window.MessageCache = {
    getById: (id: string) => {
      const attributes = byId.get(id);
      return attributes ? { attributes } : undefined;
    },
  } as unknown as typeof window.MessageCache;

  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  // The action is an async thunk that its type calls `void`.
  const done = actions.toggleForwardMessagesModal({
    type: ForwardMessagesModalType.Forward,
    messageIds: messages.map(message => message.id),
  })(
    (action: unknown) => {
      dispatched.push(action as { type: string; payload?: unknown });
      return action;
    },
    () => state,
    undefined
  ) as unknown as Promise<void>;
  await done;

  const opened = dispatched.find(
    action => action.type === 'globalModals/TOGGLE_FORWARD_MESSAGES_MODAL'
  );
  const payload = opened?.payload as
    | { messageDrafts: ReadonlyArray<MessageForwardDraft> }
    | undefined;
  assert.isDefined(payload, 'the forward modal opened');
  return payload?.messageDrafts ?? [];
}

// Stands for the files of the attachments: any picture that has a path reads as these bytes.
async function readFromDisk(): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array([1, 2, 3]);
}

const UI_ONLY_KEYS = ['card', 'layout', 'cardIcon', 'firstPartyLocal'];

function assertNoUiFields(preview: object): void {
  for (const key of UI_ONLY_KEYS) {
    assert.notProperty(preview, key, `a forwarded preview carries no ${key}`);
  }
}

describe('forwarding a message with a link preview', () => {
  let savedConversationController: typeof window.ConversationController;
  let savedMessageCache: typeof window.MessageCache;
  const contextConfig = window.SignalContext.config as { installPath?: string };
  let previousInstallPath: string | undefined;

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
    savedMessageCache = window.MessageCache;
    window.ConversationController = {
      getOurConversationId: () => 'us',
      isSignalConversationId: () => false,
    } as unknown as typeof window.ConversationController;
  });

  afterEach(() => {
    window.ConversationController = savedConversationController;
    window.MessageCache = savedMessageCache;
    _setLinkRegistryForTesting(undefined);
  });

  describe('sends the preview the message has', () => {
    it('a brand shell: as stored, without what the card was drawn from', async () => {
      const stored: LinkPreviewType = {
        url: TAOBAO,
        title: '淘宝',
        description: 'sender description',
        date: 1_690_000_000_000,
        rich: TAOBAO_RICH,
        image: { ...IMAGE },
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'brand',
            conversationId: FRIEND.id,
            body: `${TAOBAO} 快来看`,
            preview: [stored],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, [stored]);
      assertNoUiFields(draft?.previews[0] ?? {});
    });

    it('a generic card and a structured one: rich as received, unknown fields included', async () => {
      const generic: LinkPreviewType = {
        url: BILIBILI,
        title: 'Sender title',
        description: 'Sender description',
        image: { ...IMAGE },
      };
      const structured: LinkPreviewType = {
        url: BILIBILI,
        title: 'A video',
        rich: STRUCTURED_RICH,
        image: { ...IMAGE },
      };
      const drafts = await forwardDrafts(
        [
          messageWith({
            id: 'generic',
            conversationId: FRIEND.id,
            body: `look ${BILIBILI}`,
            preview: [generic],
          }),
          messageWith({
            id: 'structured',
            conversationId: FRIEND.id,
            body: `look ${BILIBILI}`,
            preview: [structured],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(drafts[0]?.previews, [generic]);
      assert.deepEqual(drafts[1]?.previews, [structured]);
      for (const draft of drafts) {
        assertNoUiFields(draft.previews[0] ?? {});
      }
    });

    it('a first-party card: as stored', async () => {
      const stored: LinkPreviewType = {
        url: GROUP_LINK,
        title: 'Book club',
        description: '12 members',
        isStickerPack: false,
        isCallLink: false,
        image: { ...IMAGE },
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'group',
            conversationId: FRIEND.id,
            body: GROUP_LINK,
            preview: [stored],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, [stored]);
      assertNoUiFields(draft?.previews[0] ?? {});
    });

    it('in a message request: title, description, rich and picture as stored, not the domain card', async () => {
      const stored: LinkPreviewType = {
        url: BILIBILI,
        title: 'Stranger title',
        description: 'Stranger description',
        rich: STRUCTURED_RICH,
        image: { ...IMAGE },
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'request',
            conversationId: STRANGER.id,
            body: `look ${BILIBILI}`,
            preview: [stored],
          }),
        ],
        [STRANGER]
      );
      assert.deepEqual(draft?.previews, [stored]);
      assertNoUiFields(draft?.previews[0] ?? {});
    });

    it('a preview whose card is a plain link (its URL is not in the text): as stored', async () => {
      // The receiver draws such a preview as a plain link, and not at all when there is more in
      // the message than that link; either way it is what the message has that goes on.
      const stored: LinkPreviewType = {
        url: BILIBILI,
        title: 'Sender title',
        rich: STRUCTURED_RICH,
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'plain',
            conversationId: FRIEND.id,
            body: 'no link in this text',
            preview: [stored],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, [stored]);
    });
  });

  describe('adds no preview a message does not have', () => {
    it('a message that is just a link, sent without a preview, has none after forwarding', async () => {
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'link-only',
            conversationId: FRIEND.id,
            body: BILIBILI,
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, []);
    });

    it('the same in a message request', async () => {
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'link-only-request',
            conversationId: STRANGER.id,
            body: BILIBILI,
          }),
        ],
        [STRANGER]
      );
      assert.deepEqual(draft?.previews, []);
    });
  });

  describe('a message that was itself forwarded by an earlier build', () => {
    it('does not pass the screen-only fields on again', async () => {
      // What older builds stored in a forwarded message's preview: the fields its card was drawn
      // from, the brand icon as a `data:` URL included. (A picture's own screen-only fields,
      // like its local `url`, are never stored with it.)
      const clean: LinkPreviewType = {
        url: TAOBAO,
        title: '淘宝',
        rich: TAOBAO_RICH,
        image: { ...IMAGE },
      };
      const polluted = {
        ...clean,
        domain: 'item.taobao.com',
        isStickerPack: false,
        isCallLink: false,
        card: { level: 'brand', provider: 'taobao', kind: 'web' },
        layout: 'icon',
        cardIcon: {
          url: 'data:image/png;base64,AAAA',
          width: 108,
          height: 108,
        },
        firstPartyLocal: { joined: true },
        isGroupLinkInactive: false,
      } as unknown as LinkPreviewType;
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'polluted',
            conversationId: FRIEND.id,
            body: TAOBAO,
            preview: [polluted],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, [
        {
          ...clean,
          domain: 'item.taobao.com',
          isStickerPack: false,
          isCallLink: false,
        },
      ]);
      assertNoUiFields(draft?.previews[0] ?? {});
      assert.notProperty(draft?.previews[0] ?? {}, 'isGroupLinkInactive');
    });
  });

  describe('a picture that is not on this device', () => {
    it('is left out; the rest of the preview goes on, and the forward does not fail', async () => {
      const stored: LinkPreviewType = {
        url: BILIBILI,
        title: 'Sender title',
        rich: STRUCTURED_RICH,
        image: omit(IMAGE, 'path'),
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'no-picture',
            conversationId: FRIEND.id,
            body: `look ${BILIBILI}`,
            preview: [stored],
          }),
        ],
        [FRIEND]
      );
      assert.deepEqual(draft?.previews, [omit(stored, 'image')]);

      // The step after the modal reads the picture from disk, and throws on a picture that has no
      // file ("'attachment.path' is required"), which would fail the whole forward.
      const loaded = await loadPreviewData(loadData(readFromDisk))([
        ...(draft?.previews ?? []),
      ]);
      assert.lengthOf(loaded, 1);
    });
  });

  describe('what goes on the wire', () => {
    it('is the message’s own preview, byte for byte, `rich` included', async () => {
      const stored: LinkPreviewType = {
        url: BILIBILI,
        title: 'A video',
        description: 'Sender description',
        date: 1_690_000_000_000,
        rich: STRUCTURED_RICH,
      };
      const [draft] = await forwardDrafts(
        [
          messageWith({
            id: 'wire',
            conversationId: STRANGER.id,
            body: `look ${BILIBILI}`,
            preview: [stored],
          }),
        ],
        [STRANGER]
      );

      const [forwarded] = await loadPreviewData(loadData(readFromDisk))([
        ...(draft?.previews ?? []),
      ]);
      if (!forwarded) {
        throw new Error('nothing was forwarded');
      }

      // What the message itself sent, and what its forwarded copy sends. (There is no picture in
      // these previews: what is uploaded for one is another matter.)
      const original = Proto.Preview.encode(
        toOutgoingPreviewProto({ ...stored, image: undefined })
      );
      const forwardedBytes = Proto.Preview.encode(
        toOutgoingPreviewProto({ ...forwarded, image: undefined })
      );
      assert.isTrue(Bytes.areEqual(forwardedBytes, original));

      // And the unknown field 99 is still in the bytes that were forwarded.
      const decoded = Proto.Preview.decode(forwardedBytes);
      assert.isDefined(decoded.rich);
      assert.isTrue(
        Bytes.areEqual(
          Proto.RichContent.encode(
            decoded.rich ?? Proto.RichContent.decode(new Uint8Array(0))
          ),
          STRUCTURED_RICH_BYTES
        )
      );
    });
  });
});
