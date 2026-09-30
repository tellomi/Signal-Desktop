// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import createDebug from 'debug';
import * as sinon from 'sinon';
import {
  EMPTY_DATA_MESSAGE,
  type PrimaryDevice,
  Proto as MockProto,
  StorageState,
} from '@signalapp/mock-server';

import * as Bytes from '../../Bytes.std.ts';
import * as durations from '../../util/durations/index.std.ts';
import { SignalService as DesktopProto } from '../../protobuf/index.std.ts';
import type { TestLinkPreviewPayload } from '../../linkPreviews/testLinkPreview.std.ts';
import { buildTestRichBytes } from '../../linkPreviews/testLinkPreview.std.ts';
import type { Page } from 'playwright';
import type { App } from '../playwright.node.ts';
import { Bootstrap } from '../bootstrap.node.ts';
import { getMessageInTimelineByTimestamp } from '../helpers.node.ts';

export const debug = createDebug('mock:test:testLinkPreview');

// ADR-0063 §8.1 row 2 ("测试发送工具能发出第 10 行的每一条样例") and row 10 (§6.1 "恶意发送者"):
// a tool, in an app that is run from its sources, that sends a message whose link preview is
// anything a modified client could send, through the app's own send path, so that the receiving
// end of every platform can be tested with it. Here the app is real (Electron), so is its send
// path (job queue, encryption, attachment upload) and its receiving path (decryption, storage,
// the timeline); the network is the mock server: nothing leaves this machine, no number is
// registered.

// Field 1000 (`Preview.rich`) as it is on the wire: key 1000 << 3 | 2 = 0xc2 0x3e, a varint length,
// the bytes. Written out here, not taken from the code under test.
function field1000(rich: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const length: Array<number> = [];
  let rest = rich.byteLength;
  while (rest >= 128) {
    length.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  length.push(rest);
  return Bytes.concatenate([
    new Uint8Array([0xc2, 0x3e]),
    new Uint8Array(length),
    rich,
  ]);
}

// A picture of one pixel that the app can decode, which a receiver is told is 1200 × 630.
const PNG_1X1 = Bytes.fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
);

// What goes on the wire after the known fields of a `RichContent`: field 99, length-delimited, as
// a newer sender would add it.
const NEWER_HEX = Bytes.toHex(Bytes.fromString('from a newer client'));

function hex(...fields: Array<string>): string {
  return fields.join('');
}

const TAOBAO = 'https://item.taobao.com/item.htm?id=100032608854';
const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';

type Sample = Readonly<{
  name: string;
  payload: TestLinkPreviewPayload;
  // `rich` exactly as the receiver should get it, written by hand, field by field, where it is
  // short enough to; otherwise what the tool builds from the parts.
  richHex?: string;
  // What Desktop draws for this preview when it is received (no picture), the card's text line by
  // line, by the rules of ADR-0063 §5.3 and §6.1 and card-visual §3.7: the same in every language,
  // or by language (the platform name and the kind are in the language of the app).
  card:
    | ReadonlyArray<string>
    | Readonly<Record<'en' | 'zh-CN', ReadonlyArray<string>>>;
  // Whether Desktop still has `rich` once it is received (§6.1: over the limits it is dropped
  // whole and not stored; a rich that does not match the link is stored and only not used).
  keepsRich: boolean;
}>;

const SAMPLES: ReadonlyArray<Sample> = [
  {
    name: 'a brand shell',
    payload: {
      body: `${TAOBAO} 快来看`,
      preview: {
        url: TAOBAO,
        title: '淘宝',
        rich: { kind: 'product', provider: 'taobao', schema: 1, level: 1 },
      },
    },
    // kind "product", provider "taobao", schema 1, level 1
    richHex: hex('0a0770726f64756374', '120674616f62616f', '1801', '3001'),
    card: {
      en: ['Taobao', 'Product', 'taobao.com'],
      'zh-CN': ['淘宝', '商品', 'taobao.com'],
    },
    keepsRich: true,
  },
  {
    name: 'a structured video, with a picture of a size it does not have, and a field this build does not know',
    payload: {
      body: BILIBILI,
      preview: {
        url: BILIBILI,
        title: '柯洁围棋入门课',
        description: '课程简介',
        date: 1_790_000_000_000,
        imageBase64: Bytes.toBase64(PNG_1X1),
        imageWidth: 1200,
        imageHeight: 630,
        rich: {
          kind: 'video',
          provider: 'bilibili',
          schema: 1,
          level: 2,
          attrs: [{ key: 'author', value: 'Kai' }],
          unknownFields: [{ field: 99, hex: NEWER_HEX }],
        },
      },
    },
    // kind, provider, schema, one attribute (13 bytes: author / Kai), level, then field 99
    richHex: hex(
      '0a05766964656f',
      '120862696c6962696c69',
      '1801',
      '2a0d',
      '0a06617574686f72',
      '12034b6169',
      '3002',
      `9a0613${NEWER_HEX}`
    ),
    // Received here without its picture (see `receive`): a video needs one, so a brand shell.
    card: {
      en: ['Bilibili', 'Video', 'bilibili.com'],
      'zh-CN': ['哔哩哔哩', '视频', 'bilibili.com'],
    },
    keepsRich: true,
  },
  {
    name: 'a brand-tier platform that says it is a structured card, with attributes',
    payload: {
      body: TAOBAO,
      preview: {
        url: TAOBAO,
        title: '淘宝',
        rich: {
          kind: 'product',
          provider: 'taobao',
          schema: 1,
          level: 2,
          attrs: [{ key: 'price', value: '1' }],
        },
      },
    },
    // kind, provider, schema, one attribute (10 bytes: price / 1), level
    richHex: hex(
      '0a0770726f64756374',
      '120674616f62616f',
      '1801',
      '2a0a',
      '0a057072696365',
      '120131',
      '3002'
    ),
    card: {
      en: ['Taobao', 'Product', 'taobao.com'],
      'zh-CN': ['淘宝', '商品', 'taobao.com'],
    },
    keepsRich: true,
  },
  {
    name: 'a look-alike of a first-party user card with a title that is not the user',
    payload: {
      body: 'https://tell.cc/kaixin',
      preview: {
        url: 'https://tell.cc/kaixin',
        title: '@客服 Tellomi 官方',
        rich: {
          kind: 'tellomi.user',
          provider: 'tellomi',
          schema: 1,
          level: 2,
        },
      },
    },
    richHex: hex(
      '0a0c74656c6c6f6d692e75736572',
      '120774656c6c6f6d69',
      '1801',
      '3002'
    ),
    // The name is worked out from the URL, never taken from the sender; the letter is the
    // avatar's.
    card: {
      en: ['k', '@kaixin', 'Tellomi user', 'Message'],
      'zh-CN': ['k', '@kaixin', 'Tellomi 用户', '发消息'],
    },
    keepsRich: true,
  },
  {
    name: 'a rich content over every limit: kind of 33 characters, 20 attributes',
    payload: {
      body: BILIBILI,
      preview: {
        url: BILIBILI,
        title: 'Title the sender wrote',
        rich: {
          kind: 'k'.repeat(33),
          provider: 'bilibili',
          schema: 1,
          level: 2,
          attrs: Array.from({ length: 20 }, (_, index) => ({
            key: `key_${index}`,
            value: 'v'.repeat(300),
          })),
        },
      },
    },
    // Dropped whole: what is left is a generic preview of the snapshot.
    card: ['Title the sender wrote', 'bilibili.com'],
    keepsRich: false,
  },
  {
    name: 'a short link that changes provider: a bilibili short link claiming to be a taobao product',
    payload: {
      body: 'https://b23.tv/abcdef',
      preview: {
        url: 'https://b23.tv/abcdef',
        title: 'Short link',
        rich: {
          kind: 'product',
          provider: 'taobao',
          schema: 1,
          level: 2,
          canonicalUrl: TAOBAO,
        },
      },
    },
    // The provider of a short link is the one whose short domain it is: a claim of another
    // provider is not taken.
    card: ['Short link', 'b23.tv'],
    keepsRich: true,
  },
  {
    name: 'a preview without rich, as an older client sends it',
    payload: {
      body: `look ${BILIBILI}`,
      preview: { url: BILIBILI, title: 'An older client', description: 'text' },
    },
    card: ['An older client', 'bilibili.com'],
    keepsRich: false,
  },
];

function getExpectedRichHex(sample: Sample): string | undefined {
  const { rich } = sample.payload.preview;
  return (
    sample.richHex ?? (rich ? Bytes.toHex(buildTestRichBytes(rich)) : undefined)
  );
}

// The window's own world: the one `window.reduxStore`, `window.ConversationController` and
// `window.SignalContext` are in (the page's main world has only what is exposed to it), reached over
// the debugging protocol the way scripts/local-stack/desktop-eval.mjs in the repository above this
// one reaches it against `--remote-debugging-port`: the execution context Electron names
// 'Electron Isolated Context'.
type OwnWorldType = Readonly<{
  evaluate: (expression: string) => Promise<unknown>;
  detach: () => Promise<void>;
}>;

async function connectToOwnWorld(page: Page): Promise<OwnWorldType> {
  const session = await page.context().newCDPSession(page);
  const contexts: Array<{
    id: number;
    name: string;
    auxData?: { isDefault?: boolean };
  }> = [];
  session.on('Runtime.executionContextCreated', event => {
    contexts.push(event.context);
  });
  await session.send('Runtime.enable');
  const find = () =>
    contexts.find(context => context.name === 'Electron Isolated Context') ??
    contexts.find(context => !context.auxData?.isDefault);
  for (let waited = 0; !find() && waited < 5000; waited += 100) {
    // oxlint-disable-next-line no-await-in-loop
    await page.waitForTimeout(100);
  }
  const isolated = find();
  assert.isDefined(isolated, "the window's own world");

  return {
    evaluate: async expression => {
      const { result, exceptionDetails } = await session.send(
        'Runtime.evaluate',
        {
          expression,
          contextId: isolated?.id,
          awaitPromise: true,
          returnByValue: true,
        }
      );
      assert.isUndefined(exceptionDetails, JSON.stringify(exceptionDetails));
      return result.value;
    },
    detach: () => session.detach(),
  };
}

describe('messaging/testLinkPreview', function (this: Mocha.Suite) {
  this.timeout(durations.MINUTE);

  let bootstrap: Bootstrap;
  let app: App;
  let contact: PrimaryDevice;

  beforeEach(async () => {
    bootstrap = new Bootstrap();
    await bootstrap.init();

    const { phone, contacts } = bootstrap;
    [contact] = contacts as [PrimaryDevice];

    let state = StorageState.getEmpty();
    state = state.addContact(contact, {
      identityKey: contact.publicKey.serialize(),
      profileKey: contact.profileKey.serialize(),
      whitelisted: true,
    });
    state = state.pin(contact);
    await phone.setStorageState(state);

    app = await bootstrap.link();
  });

  afterEach(async function (this: Mocha.Context) {
    if (!bootstrap) {
      return;
    }
    await bootstrap.maybeSaveLogs(this.currentTest, app);
    await app.close();
    await bootstrap.teardown();
  });

  async function send(
    payload: TestLinkPreviewPayload
  ): Promise<{ messageId: string; timestamp: number }> {
    const page = await app.getWindow();
    return page.evaluate(
      `window.TellomiTestTools.sendTestLinkPreview(${JSON.stringify(
        contact.device.aci
      )}, ${JSON.stringify(payload)})`
    ) as Promise<{ messageId: string; timestamp: number }>;
  }

  describe('Desktop sends', () => {
    it('has the tool in this run, made only of what a test needs', async () => {
      const page = await app.getWindow();
      assert.strictEqual(
        await page.evaluate('typeof window.TellomiTestTools'),
        'object'
      );
      assert.deepEqual(
        await page.evaluate('Object.keys(window.TellomiTestTools)'),
        ['sendTestLinkPreview']
      );
    });

    it('does not send to a conversation that does not exist', async () => {
      const page = await app.getWindow();
      let error: unknown;
      try {
        await page.evaluate(
          `window.TellomiTestTools.sendTestLinkPreview('nobody', ${JSON.stringify(
            { body: BILIBILI, preview: { url: BILIBILI } }
          )})`
        );
      } catch (caught) {
        error = caught;
      }
      assert.include(String(error), 'no conversation');
      assert.strictEqual(contact.getMessageQueueSize(), 0);
    });

    // How a person drives it against a running app: over the debugging protocol, in the window's
    // own world.
    it("can be driven over the debugging protocol, in the window's own world", async () => {
      const page = await app.getWindow();
      // The conversation has to be there (the contact is in the left pane once it is synced).
      await page.getByTestId(contact.device.aci).waitFor();
      const world = await connectToOwnWorld(page);
      try {
        assert.strictEqual(
          await world.evaluate(
            'typeof window.TellomiTestTools + typeof window.ConversationController'
          ),
          'objectobject'
        );

        const payload: TestLinkPreviewPayload = {
          body: `${BILIBILI} from the debugger`,
          preview: {
            url: BILIBILI,
            title: 'Sent over the debugging protocol',
            rich: { kind: 'video', provider: 'bilibili', schema: 1, level: 2 },
          },
        };
        const result = (await world.evaluate(
          `window.TellomiTestTools.sendTestLinkPreview(${JSON.stringify(
            contact.device.aci
          )}, ${JSON.stringify(payload)})`
        )) as { messageId: string; richBase64: string; richLength: number };
        assert.isString(result.messageId);
        assert.strictEqual(
          result.richBase64,
          Bytes.toBase64(
            Bytes.fromHex(
              hex('0a05766964656f', '120862696c6962696c69', '1801', '3002')
            )
          )
        );
        assert.strictEqual(result.richLength, 21);

        const received = await contact.waitForMessage();
        assert.strictEqual(received.body, payload.body);
        const [preview] = received.dataMessage.preview ?? [];
        assert.strictEqual(preview?.title, 'Sent over the debugging protocol');
        assert.lengthOf(preview?.$unknown ?? [], 1);
      } finally {
        await world.detach();
      }
    });

    async function checkWhatReachesThePhone(sample: Sample): Promise<void> {
      const { payload } = sample;
      const page = await app.getWindow();
      await page.getByTestId(contact.device.aci).click();

      const queued = await send(payload);
      debug('queued', queued.messageId);

      // The message leaves through the ordinary send path and arrives at the contact.
      const received = await contact.waitForMessage();
      assert.strictEqual(received.body, payload.body);
      const [preview] = received.dataMessage.preview ?? [];
      assert.isDefined(preview, 'the message has a preview');
      assert.strictEqual(preview?.url, payload.preview.url);
      assert.strictEqual(preview?.title ?? undefined, payload.preview.title);
      assert.strictEqual(
        preview?.description ?? undefined,
        payload.preview.description
      );
      if (payload.preview.date !== undefined) {
        assert.strictEqual(Number(preview?.date), payload.preview.date);
      }

      // `Preview.rich`, field 1000: the mock server does not know it and keeps it as it came.
      const unknown = preview?.$unknown ?? [];
      const expectedHex = getExpectedRichHex(sample);
      if (expectedHex === undefined) {
        assert.lengthOf(unknown, 0, 'no rich');
      } else {
        assert.lengthOf(unknown, 1, 'rich');
        assert.strictEqual(
          Bytes.toHex(unknown[0] ?? new Uint8Array(0)),
          Bytes.toHex(field1000(Bytes.fromHex(expectedHex)))
        );
      }

      // The picture: an attachment pointer with the size the payload said, not the real one.
      if (payload.preview.imageBase64 !== undefined) {
        assert.isDefined(preview?.image, 'the picture was uploaded');
        assert.strictEqual(preview?.image?.width, payload.preview.imageWidth);
        assert.strictEqual(preview?.image?.height, payload.preview.imageHeight);
        assert.strictEqual(preview?.image?.contentType, 'image/png');
      } else {
        assert.isNull(preview?.image ?? null);
      }

      // And in the timeline of Desktop too, the way any sent message is.
      await getMessageInTimelineByTimestamp(page, queued.timestamp).waitFor();
    }

    it('measures the picture when the payload does not say how big it is, and sends its bytes as they are', async () => {
      const page = await app.getWindow();
      await page.getByTestId(contact.device.aci).click();

      await send({
        body: `${BILIBILI} with its own size`,
        preview: {
          url: BILIBILI,
          title: 'A picture of one pixel',
          imageBase64: Bytes.toBase64(PNG_1X1),
        },
      });

      const received = await contact.waitForMessage();
      const [preview] = received.dataMessage.preview ?? [];
      assert.strictEqual(preview?.image?.width, 1);
      assert.strictEqual(preview?.image?.height, 1);
      assert.strictEqual(preview?.image?.contentType, 'image/png');
      assert.strictEqual(Number(preview?.image?.size), PNG_1X1.byteLength);
      assert.isString(preview?.image?.blurHash);
    });

    for (const sample of SAMPLES) {
      it(`${sample.name}: what reaches the other phone is what was built, byte for byte`, () =>
        checkWhatReachesThePhone(sample));
    }
  });

  describe('Desktop receives', () => {
    // What another platform sends, through the mock server, to Desktop: the message built with the
    // encoder of Desktop's own protocol description (the mock server's leaves out the fields it
    // does not know), and sent as the bytes of the message content: they are encrypted and
    // delivered by the mock server as any message is. Desktop's decoding, its storing and its
    // timeline do the rest.
    async function receive(sample: Sample): Promise<number> {
      const { payload } = sample;
      const expectedHex = getExpectedRichHex(sample);
      const timestamp = bootstrap.getTimestamp();

      const content = DesktopProto.Content.encode({
        content: {
          dataMessage: {
            ...EMPTY_DATA_MESSAGE,
            body: payload.body,
            timestamp: BigInt(timestamp),
            preview: [
              {
                url: payload.preview.url,
                title: payload.preview.title ?? null,
                description: payload.preview.description ?? null,
                date: null,
                // A picture would have to be uploaded by the sender: these are received without.
                image: null,
                rich: null,
                $unknown: expectedHex
                  ? [field1000(Bytes.fromHex(expectedHex))]
                  : null,
              },
            ],
          },
        },
        senderKeyDistributionMessage: null,
        pniSignatureMessage: null,
      });

      // `sendRaw` encodes the content it is given as its first step, synchronously: the encoder of
      // the mock server is the bytes above for that one call.
      const stub = sinon
        .stub(MockProto.Content, 'encode')
        .callsFake(() => content);
      let sent: Promise<void>;
      try {
        sent = contact.sendRaw(
          bootstrap.desktop,
          { content: { dataMessage: EMPTY_DATA_MESSAGE } } as never,
          { timestamp }
        );
      } finally {
        stub.restore();
      }
      await sent;
      return timestamp;
    }

    async function checkStoredAndDrawn(
      context: Mocha.Context,
      sample: Sample
    ): Promise<void> {
      const page = await app.getWindow();
      await page.getByTestId(contact.device.aci).click();

      // What the card says is in the language of the app, which is the language of this machine.
      const world = await connectToOwnWorld(page);
      let locale: unknown;
      try {
        locale = await world.evaluate('window.SignalContext.getI18nLocale()');
      } finally {
        await world.detach();
      }
      const expected = Array.isArray(sample.card)
        ? sample.card
        : (sample.card as Readonly<Record<string, ReadonlyArray<string>>>)[
            String(locale)
          ];
      if (!expected) {
        context.skip();
      }

      const timestamp = await receive(sample);
      const message = getMessageInTimelineByTimestamp(page, timestamp);
      await message.waitFor();

      // What the timeline shows of the preview.
      const card = message.locator('.module-message__link-preview');
      await card.waitFor();
      // The words of the card, line by line. A line with no letter or digit is an icon (the link
      // glyph of a card without a picture is a character of an icon font), not a word.
      const lines = (await card.innerText())
        .split('\n')
        .map(line => line.trim())
        .filter(line => /[\p{L}\p{N}]/u.test(line));
      assert.deepEqual(lines, expected, `in ${String(locale)}`);

      // What Desktop stored: `rich` as it arrived, unknown fields included, or not at all.
      const [stored] = await app.getMessagesBySentAt(timestamp);
      const storedRich = stored?.preview?.[0]?.rich;
      const expectedHex = getExpectedRichHex(sample);
      if (sample.keepsRich && expectedHex !== undefined) {
        assert.strictEqual(
          storedRich,
          Bytes.toBase64(Bytes.fromHex(expectedHex))
        );
      } else {
        assert.isUndefined(storedRich);
      }
    }

    for (const sample of SAMPLES) {
      it(`${sample.name}: stored as it arrived, drawn by the rules of the receiving end`, function (this: Mocha.Context) {
        return checkStoredAndDrawn(this, sample);
      });
    }
  });
});

// An app that is not a test run, as a release is: what the app tells its window about itself in
// that case is `PackagedApp` and no CI mode (app/main.main.ts). The tool is not there: not an
// object that refuses, nothing. (A packaged app itself is not started: its configuration points
// at the real servers.)
describe('messaging/testLinkPreview in an app that is not a test run', function (this: Mocha.Suite) {
  this.timeout(durations.MINUTE);

  it('has no tools at all', async () => {
    const bootstrap = new Bootstrap();
    await bootstrap.init();
    // CI mode 'benchmark': the window is told it is `PackagedApp`, without the test hooks.
    const app = await bootstrap.startApp({ ciMode: 'benchmark' });
    try {
      const page = await app.getWindow();
      await page.waitForLoadState('load');
      assert.strictEqual(
        await page.evaluate('typeof window.TellomiTestTools'),
        'undefined'
      );
      assert.strictEqual(
        await page.evaluate(
          'Object.keys(window).filter(key => /tellomi/i.test(key)).length'
        ),
        0
      );
    } finally {
      try {
        await app.close();
      } catch {
        // `close` looks for fatal errors through the test hooks, which this mode does not have;
        // the app is closed either way.
      }
      await bootstrap.teardown();
    }
  });
});
