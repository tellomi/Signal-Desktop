// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';
import { CallLinkRootKey } from '@signalapp/ringrtc';

import * as Bytes from '../../Bytes.std.ts';
import { getReceivedLinkPreviews } from '../../linkPreviews/receivedLinkPreviews.preload.ts';
import type {
  LinkFetchRequest,
  LinkFetchResult,
} from '../../linkPreviews/linkFetchTypes.std.ts';
import { openLinkWithHost } from '../../linkPreviews/linkOpenFlow.std.ts';
import { parseLinkOpenPlan } from '../../linkPreviews/linkOpenPlan.std.ts';
import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import { setOnLogCallback } from '../../logging/log.std.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import {
  _setLinkFetchForTesting,
  maybeGrabLinkPreview,
  resetLinkPreview,
} from '../../services/LinkPreview.preload.ts';
import type { MessageWithUIFieldsType } from '../../state/ducks/conversations.preload.ts';
import { getPropsForBubble } from '../../state/selectors/message.preload.ts';
import type { GetPropsForBubbleOptions } from '../../state/selectors/message.preload.ts';
import { getDefaultConversation } from '../../test-helpers/getDefaultConversation.std.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import { itemStorage } from '../../textsecure/Storage.preload.ts';
import { LinkPreviewSourceType } from '../../types/LinkPreview.std.ts';
import type { LinkPreviewType } from '../../types/message/LinkPreviews.std.ts';
import { getLocaleI18n } from '../util/localeI18n.node.ts';

// ADR-0063 §6.5 and §8.1 row 9 (audit K4): "日志里查不到完整 URL 和 `#` 片段。测法：发一条路径和
// `#` 片段里都带 canary 字符串的链接，走完发送、接收、点开，导出调试日志 grep canary 为 0。"
//
// A link with a canary in its path, its query and its fragment goes through the whole link path
// of this device: the preview is made (the real `maybeGrabLinkPreview` and `runLinkSendJob`, the
// real rust/links; only the network is a script), received (`getReceivedLinkPreviews`), drawn (the
// real selector the timeline uses, with this device's own data for first-party cards) and opened
// (the real flow, with a shell that only says what it was asked). Every line the logger is given on
// the way is kept, and none of them may have the canary, or any URL at all. Where a lower layer
// can throw, it throws an error that quotes the link, the worst it can say: what shows is what
// our own code logs about it.

const CANARY = 'canary7f3a';
// A sticker pack's id and key are hex, and sit in the fragment: their own canaries. So is the key
// of a call link.
const PACK_ID = 'cafe7f3a'.repeat(4);
const PACK_KEY = '7f3acafe'.repeat(8);
const CALL_KEY = CallLinkRootKey.generate().toString();
const SECRETS = [CANARY, PACK_ID, PACK_KEY, CALL_KEY.toLowerCase()];

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{ registry: string }> = JSON.parse(
  readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8')
);

// One link of each kind of card, with the canary in every part of it that is free.
const LINKS: Readonly<Record<string, string>> = {
  generic: `https://www.bbc.com/news/${CANARY}/story?at=${CANARY}#${CANARY}`,
  // A repository: the one structured card whose picture is not required, so it can be made here.
  structured: `https://github.com/${CANARY}/${CANARY}?tab=${CANARY}#${CANARY}`,
  // A video needs a picture, which a node test cannot decode: it ends as a brand shell.
  video: `https://www.bilibili.com/video/BV${CANARY}/?from=${CANARY}#${CANARY}`,
  brand: `https://item.taobao.com/${CANARY}/item.htm?id=1&spm=${CANARY}#${CANARY}`,
  official: `https://tellomi.app/${CANARY}?x=${CANARY}#${CANARY}`,
  user: `https://tell.cc/${CANARY}`,
  group: `https://tell.cc/g#${CANARY}${CANARY}${CANARY}`,
  sticker: `https://tell.cc/s#pack_id=${PACK_ID}&pack_key=${PACK_KEY}`,
  call: `https://tell.cc/call#key=${CALL_KEY}`,
  // "bi1ibili" for bilibili: the domain imitates a well-known one.
  lookalike: `https://www.bi1ibili.com/video/BV${CANARY}?x=${CANARY}#${CANARY}`,
};

const OUR_ACI = generateAci();
const FRIEND = getDefaultConversation({
  id: 'friend',
  serviceId: generateAci(),
});
const STRANGER = getDefaultConversation({
  id: 'stranger',
  serviceId: generateAci(),
  acceptedMessageRequest: false,
});

function html(title: string): string {
  return (
    `<!doctype html><html><head><title>${title}</title>` +
    `<meta property="og:title" content="${title}">` +
    `<meta property="og:description" content="About it"></head><body></body></html>`
  );
}

function shorten(line: string): string {
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function assertNoLink(lines: ReadonlyArray<string>, where: string): void {
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const secret of SECRETS) {
      assert.notInclude(lower, secret, `${where}: ${shorten(line)}`);
    }
    assert.notMatch(line, /https?:\/\//i, `${where}: ${shorten(line)}`);
  }
}

type FakeFetch = (request: LinkFetchRequest) => Promise<LinkFetchResult>;

function response(
  url: string,
  status: number,
  contentType: string,
  body: string,
  location: string | null = null
): LinkFetchResult {
  return {
    type: 'response',
    status,
    finalUrl: url,
    contentType,
    location,
    body: Bytes.fromString(body),
    redirects: 0,
  };
}

// The network as a script: the page itself, and GitHub's API for a repository. Anything else (a
// picture, an icon) is refused, so that nothing has to be decoded.
function scriptedNetwork(): FakeFetch {
  return async request => {
    if (request.url.startsWith('https://api.github.com/')) {
      return response(
        request.url,
        200,
        'application/json',
        JSON.stringify({
          full_name: `${CANARY}/${CANARY}`,
          description: 'A repository',
          owner: { login: CANARY },
        })
      );
    }
    // (The address rust/links asks for is the link without its fragment and tracking parameters.)
    if (request.kind === 'fetch') {
      return response(
        request.url,
        200,
        'text/html; charset=utf-8',
        html('A story')
      );
    }
    return { type: 'failure', reason: 'other' };
  };
}

describe('logs of the link preview path carry no URL and no fragment', () => {
  let lines: Array<string>;
  let redux: Array<{ action: string; payload?: unknown }>;
  let saved: Record<string, unknown>;
  let storageGet: sinon.SinonStub | undefined;
  let counter = 0;

  const contextConfig = window.SignalContext.config as { installPath?: string };
  let previousInstallPath: string | undefined;

  function loadRegistry(): LinkRegistry {
    return LinkRegistry.load(
      new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
    );
  }

  before(() => {
    // The brand icons ship in the app's build folder: under test that is this checkout.
    previousInstallPath = contextConfig.installPath;
    contextConfig.installPath = cwd();
  });

  after(() => {
    contextConfig.installPath = previousInstallPath;
  });

  beforeEach(() => {
    lines = [];
    setOnLogCallback((_level, line, prefix) => {
      lines.push(`${prefix ?? ''}${line}`);
    });

    const w = window as unknown as Record<string, unknown>;
    const context = window.SignalContext as unknown as Record<string, unknown>;
    saved = {
      reduxActions: w.reduxActions,
      reduxStore: w.reduxStore,
      addEventListener: w.addEventListener,
      ConversationController: w.ConversationController,
      getI18nLocale: context.getI18nLocale,
    };
    redux = [];
    w.reduxActions = {
      linkPreviews: {
        addLinkPreview: (payload: unknown) =>
          redux.push({ action: 'add', payload }),
        removeLinkPreview: () => redux.push({ action: 'remove' }),
        showGroupLinkInactive: () => redux.push({ action: 'inactive' }),
      },
    };
    w.reduxStore = { getState: () => ({ stickers: { packs: {} } }) };
    w.addEventListener = () => undefined;
    w.ConversationController = {
      getOurConversationId: () => 'us',
      getOurConversation: () => ({ get: () => undefined }),
      isSignalConversationId: () => false,
    };
    context.getI18nLocale = () => 'en';

    storageGet = sinon.stub(itemStorage, 'get');
    storageGet.callsFake(((key: string, fallback: unknown) =>
      key === 'linkPreviews' ? true : fallback) as never);

    _setLinkRegistryForTesting(loadRegistry());
    resetLinkPreview();
  });

  afterEach(() => {
    _setLinkFetchForTesting(undefined);
    resetLinkPreview();
    storageGet?.restore();
    _setLinkRegistryForTesting(undefined);
    setOnLogCallback(() => undefined);

    const w = window as unknown as Record<string, unknown>;
    const context = window.SignalContext as unknown as Record<string, unknown>;
    w.reduxActions = saved.reduxActions;
    w.reduxStore = saved.reduxStore;
    w.addEventListener = saved.addEventListener;
    w.ConversationController = saved.ConversationController;
    context.getI18nLocale = saved.getI18nLocale;
  });

  async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  // The composer has its answer: a preview (with its domain), a notice, or (after it was cleared
  // and the URL staged, with no domain yet) cleared again because nothing came of it.
  function hasSettled(): boolean {
    return redux.some(
      entry =>
        entry.action === 'inactive' ||
        (entry.action === 'add' &&
          (entry.payload as LinkPreviewType).domain !== undefined) ||
        (entry.action === 'remove' && redux.length > 2)
    );
  }

  // The preview the composer ends up with for `url`, as the real service makes it: the text goes
  // in, and after the debounce and whatever the job does the preview (or nothing) comes out.
  async function makePreview(
    url: string
  ): Promise<LinkPreviewType | undefined> {
    redux.length = 0;
    maybeGrabLinkPreview(`look ${url}`, LinkPreviewSourceType.Composer, {
      conversationId: 'friend',
    });
    for (let waited = 0; waited < 6000 && !hasSettled(); waited += 25) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(25);
    }
    await sleep(50);
    const added = redux.filter(entry => entry.action === 'add').at(-1);
    const preview = added?.payload as LinkPreviewType | undefined;
    return preview?.domain === undefined ? undefined : preview;
  }

  // What the timeline makes of a stored preview: the real selector, in a chat whose sender is
  // known and in a message request.
  function draw(
    body: string,
    preview: LinkPreviewType,
    conversation: typeof FRIEND
  ): ReturnType<typeof getPropsForBubble> {
    const timestamp = 1_700_000_000_000;
    counter += 1;
    const message = {
      id: `message-${counter}`,
      conversationId: conversation.id,
      type: 'incoming',
      body,
      sent_at: timestamp,
      timestamp,
      received_at: 1,
      received_at_ms: timestamp,
      sourceServiceId: conversation.serviceId,
      preview: [preview],
    } as unknown as MessageAttributesType as MessageWithUIFieldsType;
    const options: GetPropsForBubbleOptions = {
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
      ourAci: OUR_ACI,
      ourConversationId: 'us',
      ourNumber: undefined,
      ourPni: undefined,
      pinnedMessagesMessageIds: null,
      regionCode: 'US',
      selectedMessageIds: undefined,
      linkLocalLookup: {
        ourAci: OUR_ACI,
        getConversationByUsername: () => undefined,
        getConversationByGroupId: () => undefined,
        isStickerPackInstalled: () => false,
      },
    };
    return getPropsForBubble(message, options);
  }

  type OpenResult = Readonly<{
    opened: ReadonlyArray<string>;
    asked: number;
    copied: ReadonlyArray<string>;
    told: number;
  }>;

  // The flow that opens a link, with the registry's plan and a shell that only says what it was
  // asked: nothing is opened. `answer` is the button pressed on a warning (0 opens it anyway).
  async function open(
    url: string,
    {
      answer = 1,
      openExternal,
    }: {
      answer?: number;
      openExternal?: (target: string) => Promise<void>;
    } = {}
  ): Promise<OpenResult> {
    const registry = loadRegistry();
    const opened: Array<string> = [];
    const copied: Array<string> = [];
    let asked = 0;
    let told = 0;
    await openLinkWithHost(url, getLocaleI18n('en'), {
      getPlan: target => parseLinkOpenPlan(registry.openPlan(target)),
      ask: async () => {
        asked += 1;
        return { response: answer };
      },
      tell: async () => {
        told += 1;
      },
      openExternal: async target => {
        opened.push(target);
        await openExternal?.(target);
      },
      copyText: text => copied.push(text),
    });
    return { opened, asked, copied, told };
  }

  // What each link is expected to do on the way, so that a flow this test means to cover cannot
  // quietly stop being covered: whether the service makes a preview for it, and the level of the
  // card it is drawn as for a sender that is known (for a stranger it is always the domain card).
  const EXPECTED: Readonly<
    Record<string, Readonly<{ made: boolean; level: string }>>
  > = {
    generic: { made: true, level: 'generic' },
    structured: { made: true, level: 'structured' },
    video: { made: true, level: 'brand' },
    brand: { made: true, level: 'brand' },
    official: { made: true, level: 'first_party' },
    user: { made: true, level: 'first_party' },
    // The server, or the calling service, is what looks these up; here they fail.
    group: { made: false, level: 'first_party' },
    sticker: { made: false, level: 'first_party' },
    call: { made: false, level: 'first_party' },
    lookalike: { made: false, level: 'plain_link' },
  };

  async function runWholePath(name: string, url: string): Promise<void> {
    _setLinkFetchForTesting(scriptedNetwork());

    // Sent: the preview the composer would send, from the real service. A group, pack or
    // call that cannot be looked up here has none, and is received under a name.
    const made = await makePreview(url);
    assert.strictEqual(made !== undefined, EXPECTED[name]?.made, 'sent');
    const sent: LinkPreviewType = made ?? { url, title: 'Book club' };

    // Received. (A message that is just a link is drawn as a card of its own: that is how the
    // card of a link that imitates a well-known domain shows.)
    const body = name === 'lookalike' ? url : `look ${url}`;
    const received = getReceivedLinkPreviews([sent], body, {
      isStory: false,
      attachmentContentTypes: [],
    });
    assert.lengthOf(received, 1, 'a preview that is in the text is kept');

    // Drawn, where the sender is known and where it is a stranger.
    for (const conversation of [FRIEND, STRANGER]) {
      const bubble = draw(body, received[0] ?? sent, conversation);
      assert.strictEqual(bubble.type, 'message');
      const level =
        bubble.type === 'message'
          ? bubble.data.previews?.[0]?.card?.level
          : undefined;
      assert.strictEqual(
        level,
        conversation === STRANGER ? 'plain_link' : EXPECTED[name]?.level,
        `drawn for ${conversation.id}`
      );
    }

    // Opened: the browser is given the link, and only it.
    const { opened, asked } = await open(url);
    assert.strictEqual(asked, name === 'lookalike' ? 1 : 0);
    assert.deepEqual(opened, name === 'lookalike' ? [] : [url]);

    assert.isAbove(lines.length, 0, 'something was logged');
    assertNoLink(lines, name);
  }

  describe('the whole path, for a link of each kind of card', () => {
    for (const [name, url] of Object.entries(LINKS)) {
      it(`${name}: sent, received, drawn and opened`, () =>
        runWholePath(name, url));
    }
  });

  describe('when the network goes wrong', () => {
    const url = LINKS.generic ?? '';
    const FAILURES: Readonly<Record<string, FakeFetch>> = {
      'the connection fails': async () => ({ type: 'network_error' }),
      'the address is refused': async () => ({
        type: 'failure',
        reason: 'blocked_address',
      }),
      'the server answers 404 and quotes the address': async request =>
        response(
          request.url,
          404,
          'text/html',
          `<html><title>Not found: ${url}</title></html>`
        ),
      'the server redirects to the address itself': async request =>
        response(request.url, 302, '', '', url),
      'the answer is not a page, and is the address': async request =>
        response(request.url, 200, 'application/octet-stream', url),
      'the request throws an error that quotes the address': async request => {
        throw new Error(`socket hang up: ${request.url}`);
      },
    };

    async function runNetworkFailure(
      what: string,
      script: FakeFetch
    ): Promise<void> {
      _setLinkFetchForTesting(script);
      const made = await makePreview(url);
      assert.isUndefined(made);
      assert.isAbove(lines.length, 0, 'the failure was logged');
      assertNoLink(lines, what);
    }

    for (const [what, script] of Object.entries(FAILURES)) {
      it(`${what}: no preview, and no link in the log`, () =>
        runNetworkFailure(what, script));
    }
  });

  describe('when a lookup of this device throws an error that quotes the link', () => {
    it('a sticker pack: the kind of the error is logged, not what it says', async () => {
      const url = LINKS.sticker ?? '';
      (window as unknown as Record<string, unknown>).reduxStore = {
        getState: () => {
          throw new Error(`cannot read ${url}`);
        },
      };
      const made = await makePreview(url);
      assert.isUndefined(made);
      assert.isTrue(
        lines.some(line => line.includes('getStickerPackPreview error')),
        'the failure was logged'
      );
      assertNoLink(lines, 'sticker lookup');
    });
  });

  describe('open', () => {
    it('a link that imitates a well-known domain: asks first, and opens only if told to', async () => {
      const url = LINKS.lookalike ?? '';
      const declined = await open(url, { answer: 1 });
      assert.strictEqual(declined.asked, 1);
      assert.deepEqual(declined.opened, []);
      const accepted = await open(url, { answer: 0 });
      assert.strictEqual(accepted.asked, 1);
      assert.deepEqual(accepted.opened, [url]);
      assertNoLink(lines, 'lookalike');
    });

    it('a browser that fails with an error that quotes the link: its kind is logged, the link is copied', async () => {
      const url = LINKS.generic ?? '';
      const result = await open(url, {
        openExternal: async target => {
          throw new Error(`no application for ${target}`);
        },
      });
      assert.deepEqual(
        result.copied,
        [url],
        'the link is copied for the person'
      );
      assert.strictEqual(result.told, 1, 'and they are told so');
      assert.isTrue(
        lines.some(line => line.includes('Failed to open url: Error')),
        'the failure was logged, by its kind'
      );
      assertNoLink(lines, 'browser fails');
    });

    it('a target that is not a web link is not opened, and not logged', async () => {
      const url = `intent://scan/${CANARY}#Intent;scheme=${CANARY};S.browser_fallback_url=https%3A%2F%2F${CANARY}.test%2F;end`;
      const result = await open(url);
      assert.deepEqual(result.opened, []);
      assert.deepEqual(result.copied, []);
      assert.isTrue(
        lines.some(line => line.includes('not opening a link')),
        'that it was not opened was logged'
      );
      assertNoLink(lines, 'not a web link');
    });
  });
});

// The place that writes a failure of the lookup of a group link into the log (a group link needs
// the server, so no test that can run here reaches it), and every other line of the link code:
// none of them may hand a logger an error's own text, which can quote the link it failed on
// (§6.5). `getLinkErrorKind` is the way. The one exception is loading the link registry, which
// takes no link, only the registry's own files, and whose reason is what finding a broken
// installation takes.
describe('the source of the link code does not log what an error says', () => {
  const ROOT = cwd();
  const FILES = [
    'ts/services/LinkPreview.preload.ts',
    'app/linkOpen.main.ts',
    ...readdirSync(join(ROOT, 'ts', 'linkPreviews'))
      .filter(name => name.endsWith('.ts'))
      .map(name => `ts/linkPreviews/${name}`),
  ];
  // How many lines each file may have that log an error's own text: loading the registry.
  const REGISTRY_LOAD: Readonly<Record<string, number>> = {
    'app/linkOpen.main.ts': 1,
    'ts/linkPreviews/linkRegistry.preload.ts': 1,
  };

  // `Errors.toLogFormat(...)`, or an error handed to the logger as it is.
  const RAW = /toLogFormat\(|\blog\.\w+\([^;]*,\s*(?:error|err)\s*\)/g;

  it('finds the link code', () => {
    assert.isAbove(FILES.length, 20);
    assert.include(FILES, 'ts/linkPreviews/linkSendJob.std.ts');
  });

  for (const file of FILES) {
    it(file, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const found = source.match(RAW)?.length ?? 0;
      assert.isAtMost(
        found,
        REGISTRY_LOAD[file] ?? 0,
        `${file} writes an error's own text into a log`
      );
    });
  }
});
