// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import * as Bytes from '../../Bytes.std.ts';
import { AttachmentDownloadManager } from '../../jobs/AttachmentDownloadManager.preload.ts';
import { getReceivedLinkPreviews } from '../../linkPreviews/receivedLinkPreviews.preload.ts';
import { _setLinkRegistryForTesting } from '../../linkPreviews/linkRegistry.preload.ts';
import { setOnLogCallback } from '../../logging/log.std.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import type { MessageModel } from '../../models/messages.preload.ts';
import type { AttachmentType } from '../../types/Attachment.std.ts';
import { shouldPreviewHref } from '../../types/LinkPreview.std.ts';
import { IMAGE_JPEG } from '../../types/MIME.std.ts';
import type { LinkPreviewType } from '../../types/message/LinkPreviews.std.ts';
import { getValidLinkPreviews } from '../../util/getValidLinkPreviews.node.ts';
import { queueAttachmentDownloads } from '../../util/queueAttachmentDownloads.preload.ts';

// ADR-0063 §5.1 rule 4, §6.1, §7.4 (S2 of the cards wave 1): a preview that has just arrived goes
// through rust/links before the message is stored. `receive_check` drops the whole preview, or only
// its `rich` (§6.1: over the size limits), and never touches `rich` it keeps (§7.4: as received);
// `classify` says whether the card this preview becomes shows its picture (brand shells, user and
// official cards and plain links never do), and a picture no card shows is not kept, so it never
// enters the download queue. Anything that goes wrong in rust/links leaves the preview exactly as
// it was before this check existed. These run the real rust/links.

const FIXTURES = join(cwd(), 'fixtures', 'links');

type GoldenCase = Readonly<{
  name: string;
  preview: string;
  body: string;
  message: string;
  card: string;
  receive_check: string;
}>;

const golden: Readonly<{
  registry: string;
  classify: ReadonlyArray<GoldenCase>;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

type GoldenPreview = Readonly<{
  url: string;
  title?: string;
  description?: string;
  has_image?: boolean;
  date?: number;
  rich?: string;
}>;

type GoldenMessage = Readonly<{
  is_story?: boolean;
  attachment_content_types?: ReadonlyArray<string>;
}>;

const IMAGE: AttachmentType = {
  contentType: IMAGE_JPEG,
  size: 10_000,
  width: 1200,
  height: 630,
  cdnKey: 'the-cdn-key',
  key: 'the-key',
};

function goldenCase(name: string): GoldenCase {
  const found = golden.classify.find(testCase => testCase.name === name);
  if (!found) {
    throw new Error(`no golden case named ${name}`);
  }
  return found;
}

// A preview the way `processPreview` hands it to the message handler.
function toPreview(
  goldenPreview: GoldenPreview,
  { withImage }: { withImage: boolean }
): LinkPreviewType {
  return {
    url: goldenPreview.url,
    title: goldenPreview.title ?? '',
    description: goldenPreview.description ?? '',
    date: goldenPreview.date,
    ...(goldenPreview.rich
      ? { rich: Bytes.toBase64(Bytes.fromHex(goldenPreview.rich)) }
      : {}),
    ...(withImage ? { image: { ...IMAGE } } : {}),
  };
}

function receive(
  previews: ReadonlyArray<LinkPreviewType>,
  body: string,
  {
    isStory = false,
    attachmentContentTypes = [],
  }: { isStory?: boolean; attachmentContentTypes?: ReadonlyArray<string> } = {}
): Array<LinkPreviewType> {
  return getReceivedLinkPreviews(previews, body, {
    isStory,
    attachmentContentTypes,
  });
}

function loadRegistry(): LinkRegistry {
  return LinkRegistry.load(
    new Uint8Array(readFileSync(join(FIXTURES, golden.registry)))
  );
}

const BILIBILI = 'https://www.bilibili.com/video/BV1YDhJ6ZEL6';
const NETEASE = 'https://www.163.com/news/article/K1234.html';

describe('getReceivedLinkPreviews', () => {
  beforeEach(() => {
    _setLinkRegistryForTesting(loadRegistry());
  });

  afterEach(() => {
    _setLinkRegistryForTesting(undefined);
  });

  describe('for every shared golden case', () => {
    it('drops, trims and keeps exactly what receive_check and classify say', () => {
      assert.isAtLeast(golden.classify.length, 40);
      let dropped = 0;
      let richDropped = 0;
      let imageDropped = 0;
      let imageKept = 0;
      // Signal's own "may this URL have a preview" rule stays next to rust/links' (ADR-0063
      // §5.1 rule 4: only the "URL is in the body" check is folded into `receive_check`). It is
      // the stricter of the two: it decodes a punycode host (a look-alike host is mixed script
      // once decoded) and it distrusts a path with non-ASCII characters.
      const droppedBySignalAlone: Array<string> = [];

      for (const testCase of golden.classify) {
        const preview: GoldenPreview = JSON.parse(testCase.preview);
        const message: GoldenMessage = JSON.parse(testCase.message || '{}');
        const check = JSON.parse(testCase.receive_check);
        const card = JSON.parse(testCase.card);
        const input = toPreview(preview, {
          withImage: preview.has_image === true,
        });

        const result = receive([input], testCase.body, {
          isStory: message.is_story ?? false,
          attachmentContentTypes: message.attachment_content_types ?? [],
        });

        if (!check.keep_preview) {
          assert.lengthOf(result, 0, `${testCase.name}: the preview goes`);
          dropped += 1;
          continue;
        }
        if (!shouldPreviewHref(input.url)) {
          assert.lengthOf(
            result,
            0,
            `${testCase.name}: Signal's rule drops it`
          );
          droppedBySignalAlone.push(testCase.name);
          continue;
        }
        assert.lengthOf(result, 1, `${testCase.name}: the preview stays`);
        const [kept] = result;
        assert.isDefined(kept);

        // The snapshot always stands.
        assert.strictEqual(kept?.url, input.url, testCase.name);
        assert.strictEqual(kept?.title, input.title, testCase.name);
        assert.strictEqual(kept?.description, input.description, testCase.name);
        assert.strictEqual(kept?.date, input.date, testCase.name);

        // `rich`: as received, or gone.
        if (input.rich != null && !check.keep_rich) {
          assert.notProperty(kept, 'rich', `${testCase.name}: rich is dropped`);
          richDropped += 1;
        } else {
          assert.strictEqual(kept?.rich, input.rich, `${testCase.name}: rich`);
        }

        // The picture: kept when the card shows it.
        if (preview.has_image === true) {
          if (card.show_image) {
            assert.deepEqual(
              kept?.image,
              IMAGE,
              `${testCase.name}: picture kept`
            );
            imageKept += 1;
          } else {
            assert.notProperty(
              kept,
              'image',
              `${testCase.name}: no card shows the picture, so it is not kept`
            );
            imageDropped += 1;
          }
        }
      }

      assert.deepEqual(droppedBySignalAlone, [
        '§6.1 lookalike domain (punycode Cyrillic аррӏе.com) → plain link, flagged',
        '§6.1 official path is shown encoded and truncated, never decoded',
      ]);

      // The golden really exercises all three outcomes.
      assert.isAbove(dropped, 0);
      assert.isAbove(richDropped, 0);
      assert.isAbove(imageDropped, 0);
      assert.isAbove(imageKept, 0);
    });
  });

  describe('the whole preview', () => {
    it('goes when the URL is not in the body, and the message needs nothing else', () => {
      assert.deepEqual(
        receive(
          [toPreview({ url: BILIBILI, title: 't' }, { withImage: false })],
          'hello'
        ),
        []
      );
    });

    it('goes when rust/links says the URL is not a legal preview URL, though Signal alone would keep it', () => {
      const url = 'https://forum.i2p/topic/1';
      const previews = [toPreview({ url, title: 't' }, { withImage: false })];
      assert.lengthOf(
        getValidLinkPreviews(previews, url, { isStory: false }),
        1,
        'Signal alone keeps it'
      );
      assert.lengthOf(receive(previews, url), 0);
    });

    it('stays when the URL is in the body up to a trailing slash: rust/links is the one rule', () => {
      const previews = [
        toPreview(
          { url: 'https://tellomi.app/x', title: 't' },
          { withImage: false }
        ),
      ];
      const body = 'see https://tellomi.app/x/';
      assert.lengthOf(
        getValidLinkPreviews(previews, body, { isStory: false }),
        0,
        'Signal alone wants the exact link'
      );
      assert.lengthOf(receive(previews, body), 1);
    });

    it('keeps what Signal checks besides that: https, a domain that may have a preview', () => {
      for (const url of [
        'http://www.bilibili.com/video/BV1YDhJ6ZEL6',
        'https://localhost/x',
        'https://a.example.com/x',
        'https://debuglogs.org/x',
      ]) {
        assert.lengthOf(
          receive([toPreview({ url, title: 't' }, { withImage: false })], url),
          0,
          url
        );
      }
    });

    it('needs no URL in the body for a story', () => {
      assert.lengthOf(
        receive(
          [toPreview({ url: NETEASE, title: 't' }, { withImage: false })],
          '',
          {
            isStory: true,
          }
        ),
        1
      );
    });

    it('marks a call link as before', () => {
      const url =
        'https://tell.cc/call/#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';
      const [kept] = receive([toPreview({ url }, { withImage: false })], url);
      assert.isTrue(kept?.isCallLink);
    });
  });

  // ADR-0063 §5.1 rule 2 (a preview that goes wrong never becomes an error): a preview whose link
  // cannot be read costs that one preview, never the message it came in. Signal reads a call
  // link's key to derive the room id and throws when it is not a key; the message handler lets
  // that end the whole message, so nothing was stored. Sticker pack and group invite links are
  // not read in a way that can fail when a message arrives: their tests pin that, so the day
  // something starts reading them, these say so.
  describe('a preview whose link cannot be read', () => {
    const CALL_KEY = 'bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz';
    const GOOD_CALL = `https://tell.cc/call#key=${CALL_KEY}`;
    const PACK_ID = '0123456789abcdef0123456789abcdef';
    const PACK_KEY = 'ab'.repeat(32);

    type FilterType = Readonly<{
      name: string;
      run: (
        previews: ReadonlyArray<LinkPreviewType>,
        body: string
      ) => Array<LinkPreviewType>;
    }>;

    // Signal's own filter alone, and the one the message handler runs: Signal's with rust/links'
    // decision in it.
    const filters: ReadonlyArray<FilterType> = [
      {
        name: 'Signal’s own filter',
        run: (previews, body) =>
          getValidLinkPreviews(previews, body, { isStory: false }),
      },
      {
        name: 'the filter with rust/links’ decision',
        run: (previews, body) => receive(previews, body),
      },
    ];

    function preview(url: string): LinkPreviewType {
      return toPreview({ url, title: 'A title' }, { withImage: false });
    }

    const UNREADABLE_CALL_LINKS: ReadonlyArray<readonly [string, string]> = [
      ['a key that is not one', 'https://tell.cc/call#key=not-a-key'],
      ['an empty key', 'https://tell.cc/call#key='],
      ['no key at all', 'https://tell.cc/call#room=1'],
      [
        'the wrong check characters',
        `https://tell.cc/call#key=${CALL_KEY.slice(0, -1)}y`,
      ],
      [
        'a key in capitals',
        `https://tell.cc/call#key=${CALL_KEY.toUpperCase()}`,
      ],
      ['a key cut short', 'https://tell.cc/call#key=bcdf-ghkm-npqr'],
      ['the signal.link host', 'https://signal.link/call#key=not-a-key'],
      ['a slash before the #', 'https://tell.cc/call/#key=not-a-key'],
    ];

    for (const { name, run } of filters) {
      for (const [what, url] of UNREADABLE_CALL_LINKS) {
        it(`${name}: drops a call link preview with ${what}, and throws nothing`, () => {
          assert.deepEqual(run([preview(url)], `join ${url}`), []);
        });
      }
    }

    it('leaves the other previews of the message alone, before and after it', () => {
      const bad = 'https://tell.cc/call#key=not-a-key';
      for (const { name, run } of filters) {
        assert.deepEqual(
          run([preview(bad), preview(NETEASE)], `${bad} ${NETEASE}`).map(
            ({ url }) => url
          ),
          [NETEASE],
          `${name}: after`
        );
        assert.deepEqual(
          run([preview(NETEASE), preview(bad)], `${NETEASE} ${bad}`).map(
            ({ url }) => url
          ),
          [NETEASE],
          `${name}: before`
        );
      }
    });

    it('still marks a call link whose key can be read, next to one that cannot', () => {
      const bad = 'https://tell.cc/call#key=not-a-key';
      for (const { name, run } of filters) {
        const result = run(
          [preview(bad), preview(GOOD_CALL)],
          `${bad} ${GOOD_CALL}`
        );
        assert.deepEqual(
          result.map(({ url }) => url),
          [GOOD_CALL],
          name
        );
        assert.isTrue(result[0]?.isCallLink, name);
        assert.match(result[0]?.callLinkRoomId ?? '', /^[\da-f]{64}$/, name);
      }
    });

    it('is dropped by Signal’s own check, before any key is read, when the key has characters a link cannot have', () => {
      const url = 'https://tell.cc/call#key=垃圾';
      for (const { name, run } of filters) {
        assert.deepEqual(run([preview(url)], url), [], name);
      }
    });

    it('logs the drop, with the kind of the error and never the link or what follows its #', () => {
      const lines: Array<string> = [];
      setOnLogCallback((_level, line) => {
        lines.push(line);
      });
      try {
        const url = 'https://tell.cc/call#key=canary-in-fragment';
        for (const { run } of filters) {
          run([preview(url)], `join ${url}`);
        }
        assert.isTrue(
          lines.some(line => line.includes('cannot be read')),
          'the drop is logged'
        );
        for (const line of lines) {
          assert.notInclude(line.toLowerCase(), 'canary', line);
          assert.notInclude(line, 'https://', line);
        }
      } finally {
        setOnLogCallback(() => undefined);
      }
    });

    const UNREAD_STICKER_PACKS: ReadonlyArray<readonly [string, string]> = [
      [
        'a pack key that is not hex',
        `https://tell.cc/s#pack_id=${PACK_ID}&pack_key=zzzz`,
      ],
      [
        'a pack key one digit short',
        `https://tell.cc/s#pack_id=${PACK_ID}&pack_key=${PACK_KEY.slice(1)}`,
      ],
      [
        'a pack id that is not hex',
        `https://tell.cc/s#pack_id=nothex&pack_key=${PACK_KEY}`,
      ],
      ['no pack at all', 'https://tell.cc/s#garbage'],
      [
        'the signal.art host',
        `https://signal.art/addstickers#pack_id=${PACK_ID}&pack_key=zz`,
      ],
    ];
    const UNREAD_GROUP_INVITES: ReadonlyArray<readonly [string, string]> = [
      ['a # that is not base64', 'https://tell.cc/g#!!!!garbage'],
      ['base64 that is not an invite', 'https://tell.cc/g#AAAA'],
      ['the signal.group host', 'https://signal.group/#garbage'],
      ['a slash in the #', 'https://tell.cc/g#a/b'],
    ];

    for (const { name, run } of filters) {
      for (const [what, url] of [
        ...UNREAD_STICKER_PACKS.map(
          ([label, link]) =>
            [`a sticker pack link with ${label}`, link] as const
        ),
        ...UNREAD_GROUP_INVITES.map(
          ([label, link]) =>
            [`a group invite link with ${label}`, link] as const
        ),
      ]) {
        it(`${name}: keeps ${what}, reads nothing that can fail the message`, () => {
          const result = run([preview(url)], `see ${url}`);
          assert.deepEqual(
            result.map(({ url: kept }) => kept),
            [url]
          );
        });
      }
    }
  });

  describe('rich content', () => {
    const OVERSIZED =
      '§6.1 oversized RichContent (kind of 33 characters) is dropped whole → generic';
    const SEVENTEEN_ATTRS =
      '§6.1 17 attrs: the whole rich is dropped → generic';
    const NOT_PROTOBUF = 'not even protobuf → rich ignored → generic';
    const STRUCTURED =
      'structured video: sender level 2, required fields present';

    it('is dropped when it is over the limits, and the snapshot stays', () => {
      for (const name of [OVERSIZED, SEVENTEEN_ATTRS, NOT_PROTOBUF]) {
        const testCase = goldenCase(name);
        const input = toPreview(JSON.parse(testCase.preview), {
          withImage: true,
        });
        assert.isDefined(input.rich, name);
        const [kept] = receive([input], testCase.body);
        assert.isDefined(kept, name);
        assert.notProperty(kept, 'rich', name);
        assert.strictEqual(kept?.title, input.title, name);
        assert.strictEqual(kept?.description, input.description, name);
        assert.strictEqual(kept?.url, input.url, name);
        assert.deepEqual(
          kept?.image,
          IMAGE,
          `${name}: a generic card shows it`
        );
      }
    });

    it('is stored as received: the very same string, fields this build does not know included', () => {
      const testCase = goldenCase(STRUCTURED);
      const preview: GoldenPreview = JSON.parse(testCase.preview);
      // Field 99 (length-delimited, one byte) after everything the build knows.
      const withUnknownField = `${preview.rich}9a0601ff`;
      const rich = Bytes.toBase64(Bytes.fromHex(withUnknownField));
      const [kept] = receive(
        [{ ...toPreview(preview, { withImage: true }), rich }],
        testCase.body
      );
      assert.strictEqual(kept?.rich, rich);
      assert.deepEqual(kept?.image, IMAGE, 'a structured video shows it');
    });

    it('is left out of the stored preview when there is none, as before', () => {
      const [kept] = receive(
        [toPreview({ url: NETEASE, title: 'Title' }, { withImage: false })],
        NETEASE
      );
      assert.notProperty(kept, 'rich');
      assert.notProperty(kept, 'image');
    });
  });

  describe('the picture', () => {
    const cases: ReadonlyArray<Readonly<{ name: string; kept: boolean }>> = [
      {
        name: 'structured video: sender level 2, required fields present',
        kept: true,
      },
      {
        name: "old sender, no rich: generic (§5.3 'old client' / 'no rich')",
        kept: true,
      },
      {
        name: 'group: name from the snapshot, member count from a rich that agrees',
        kept: true,
      },
      { name: 'sticker pack', kept: true },
      {
        name: '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs',
        kept: false,
      },
      {
        name: 'sender says brand (level 1) although fields are complete → brand (min of the two)',
        kept: false,
      },
      {
        name: '§6.1 tell.cc user: the name comes from the URL, not the snapshot (@kefu is ignored)',
        kept: false,
      },
      {
        name: '§6.1 official card: badge from the host, fixed text + path, nothing the sender wrote',
        kept: false,
      },
      {
        name: 'rich present but the snapshot has no title → plain link',
        kept: false,
      },
    ];

    for (const { name, kept } of cases) {
      it(`${kept ? 'is kept' : 'is not kept'}: ${name}`, () => {
        const testCase = goldenCase(name);
        const input = toPreview(JSON.parse(testCase.preview), {
          withImage: true,
        });
        const message: GoldenMessage = JSON.parse(testCase.message || '{}');
        const [result] = receive([input], testCase.body, {
          isStory: message.is_story ?? false,
          attachmentContentTypes: message.attachment_content_types ?? [],
        });
        assert.isDefined(result, 'the preview itself stays');
        if (kept) {
          assert.deepEqual(result?.image, IMAGE);
        } else {
          assert.notProperty(result, 'image');
          assert.strictEqual(result?.title, input.title);
        }
      });
    }

    it('is not kept when the message has an attachment: no card is drawn for it', () => {
      const [result] = receive(
        [toPreview({ url: NETEASE, title: 'Title' }, { withImage: true })],
        NETEASE,
        { attachmentContentTypes: [IMAGE_JPEG] }
      );
      assert.isDefined(result);
      assert.notProperty(result, 'image');
    });

    it('is kept next to a long text', () => {
      const [result] = receive(
        [toPreview({ url: NETEASE, title: 'Title' }, { withImage: true })],
        NETEASE,
        { attachmentContentTypes: ['text/x-signal-plain'] }
      );
      assert.deepEqual(result?.image, IMAGE);
    });
  });

  describe('the download queue', () => {
    let addJob: sinon.SinonStub;

    beforeEach(() => {
      addJob = sinon
        .stub(AttachmentDownloadManager, 'addJob')
        .callsFake(async job => ({ ...job.attachment, pending: true }));
    });

    afterEach(() => {
      addJob.restore();
    });

    function fakeMessage(preview: Array<LinkPreviewType>): MessageModel {
      const attributes = {
        id: 'message-id',
        conversationId: 'conversation-id',
        type: 'incoming',
        sent_at: 1_700_000_000_000,
        timestamp: 1_700_000_000_000,
        received_at: 1,
        preview,
      } as unknown as MessageAttributesType;
      const model = {
        id: attributes.id,
        attributes,
        get(key: keyof MessageAttributesType) {
          return this.attributes[key];
        },
        set(values: Partial<MessageAttributesType>) {
          Object.assign(this.attributes, values);
        },
      };
      return model as unknown as MessageModel;
    }

    async function queuedPictures(
      name: string,
      { isManualDownload }: { isManualDownload: boolean }
    ): Promise<number> {
      const testCase = goldenCase(name);
      const input = toPreview(JSON.parse(testCase.preview), {
        withImage: true,
      });
      const stored = receive([input], testCase.body);
      assert.lengthOf(stored, 1, name);
      await queueAttachmentDownloads(fakeMessage(stored), { isManualDownload });
      return addJob
        .getCalls()
        .filter(call => call.args[0].attachmentType === 'preview').length;
    }

    const NO_CARD_SHOWS_THE_PICTURE = [
      '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs',
      '§6.1 tell.cc user: the name comes from the URL, not the snapshot (@kefu is ignored)',
      '§6.1 official card: badge from the host, fixed text + path, nothing the sender wrote',
      'rich present but the snapshot has no title → plain link',
    ];
    const A_CARD_SHOWS_THE_PICTURE = [
      'structured video: sender level 2, required fields present',
      "old sender, no rich: generic (§5.3 'old client' / 'no rich')",
      'group: name from the snapshot, member count from a rich that agrees',
    ];

    for (const name of NO_CARD_SHOWS_THE_PICTURE) {
      it(`does not queue the picture, automatically or by hand: ${name}`, async () => {
        assert.strictEqual(
          await queuedPictures(name, { isManualDownload: false }),
          0
        );
        assert.strictEqual(
          await queuedPictures(name, { isManualDownload: true }),
          0
        );
      });
    }

    for (const name of A_CARD_SHOWS_THE_PICTURE) {
      it(`queues the picture: ${name}`, async () => {
        assert.strictEqual(
          await queuedPictures(name, { isManualDownload: false }),
          1
        );
      });
    }
  });

  describe('when rust/links cannot answer', () => {
    // The URL carries a canary: no log line may ever quote it (ADR-0063 §6.5).
    const CANARY_URL = `${BILIBILI}?canary-in-query#canary-in-fragment`;

    let lines: Array<string>;

    beforeEach(() => {
      lines = [];
      setOnLogCallback((_level, line) => {
        lines.push(line);
      });
    });

    afterEach(() => {
      setOnLogCallback(() => undefined);
    });

    function assertNoCanaryInLogs(): void {
      for (const line of lines) {
        assert.notInclude(line.toLowerCase(), 'canary', line);
      }
    }

    // What the preview looked like before this check existed.
    function before(
      previews: ReadonlyArray<LinkPreviewType>,
      body: string
    ): Array<LinkPreviewType> {
      return getValidLinkPreviews(previews, body, { isStory: false });
    }

    const oversized = goldenCase(
      '§6.1 oversized RichContent (kind of 33 characters) is dropped whole → generic'
    );
    const oversizedPreview = (url: string): LinkPreviewType => ({
      ...toPreview(JSON.parse(oversized.preview), { withImage: true }),
      url,
    });
    const brand = goldenCase(
      '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs'
    );

    it('without a registry: exactly as before — rich and picture stay, Signal’s own URL check applies', () => {
      _setLinkRegistryForTesting(undefined);
      const url = CANARY_URL;
      const previews = [oversizedPreview(url)];
      const result = receive(previews, `see ${url}`);
      assert.deepEqual(result, before(previews, `see ${url}`));
      assert.lengthOf(result, 1);
      assert.isDefined(result[0]?.rich);
      assert.deepEqual(result[0]?.image, IMAGE);

      // Signal's exact-link rule, not rust/links' lenient one.
      const slash = [
        toPreview(
          { url: 'https://tellomi.app/x', title: 't' },
          { withImage: false }
        ),
      ];
      assert.deepEqual(receive(slash, 'see https://tellomi.app/x/'), []);

      // A brand shell keeps its picture, as before.
      const shell = toPreview(JSON.parse(brand.preview), { withImage: true });
      assert.deepEqual(receive([shell], brand.body)[0]?.image, IMAGE);
      assertNoCanaryInLogs();
    });

    function withBrokenBridge(
      overrides: Partial<Record<'receiveCheck' | 'classify', () => string>>
    ): void {
      const real = loadRegistry();
      const registry = {
        version: real.version,
        receiveCheck: (preview: string, body: string, message: string) =>
          real.receiveCheck(preview, body, message),
        classify: (preview: string, body: string, message: string) =>
          real.classify(preview, body, message),
        ...overrides,
      };
      _setLinkRegistryForTesting(registry as unknown as LinkRegistry);
    }

    it('when receive_check throws: exactly as before, and the log never quotes the URL', () => {
      withBrokenBridge({
        receiveCheck: () => {
          throw new Error(`boom ${CANARY_URL}`);
        },
      });
      const previews = [oversizedPreview(CANARY_URL)];
      const result = receive(previews, `see ${CANARY_URL}`);
      assert.deepEqual(result, before(previews, `see ${CANARY_URL}`));
      assert.lengthOf(result, 1);
      assert.isDefined(result[0]?.rich);
      assert.deepEqual(result[0]?.image, IMAGE);
      assert.isTrue(lines.some(line => line.includes('receive check failed')));
      assertNoCanaryInLogs();
    });

    it('when receive_check answers something unreadable: exactly as before', () => {
      for (const answer of [
        'not json',
        '{}',
        '{"keep_preview":"yes","keep_rich":1}',
        'null',
      ]) {
        withBrokenBridge({ receiveCheck: () => answer });
        const previews = [oversizedPreview(CANARY_URL)];
        const result = receive(previews, `see ${CANARY_URL}`);
        assert.deepEqual(result, before(previews, `see ${CANARY_URL}`), answer);
        assert.isDefined(result[0]?.rich, answer);
        assert.deepEqual(result[0]?.image, IMAGE, answer);
      }
      assertNoCanaryInLogs();
    });

    it('when classify throws: the preview and its picture stay, rich goes only if receive_check says so', () => {
      withBrokenBridge({
        classify: () => {
          throw new Error(`boom ${CANARY_URL}`);
        },
      });
      // A brand shell: with a working classify its picture would go.
      const shell = toPreview(JSON.parse(brand.preview), { withImage: true });
      const [keptShell] = receive([shell], brand.body);
      assert.deepEqual(keptShell?.image, IMAGE, 'the picture stays');
      assert.strictEqual(keptShell?.rich, shell.rich, 'rich as received');

      // Over the limits: receive_check still drops rich.
      const [keptOversized] = receive(
        [oversizedPreview(CANARY_URL)],
        `see ${CANARY_URL}`
      );
      assert.isDefined(keptOversized);
      assert.notProperty(keptOversized, 'rich');
      assert.deepEqual(keptOversized?.image, IMAGE);
      assertNoCanaryInLogs();
    });

    it('never fails the message: nothing is thrown, and every preview is still there', () => {
      withBrokenBridge({
        receiveCheck: () => {
          throw new Error('boom');
        },
        classify: () => {
          throw new Error('boom');
        },
      });
      const previews = [oversizedPreview(CANARY_URL)];
      assert.doesNotThrow(() => receive(previews, `see ${CANARY_URL}`));
      assert.lengthOf(receive(previews, `see ${CANARY_URL}`), 1);
    });
  });

  describe('logs', () => {
    it('never quote a URL or its fragment when they drop or trim a preview', () => {
      const lines: Array<string> = [];
      setOnLogCallback((_level, line) => {
        lines.push(line);
      });
      try {
        const url = `${BILIBILI}?canary-in-query#canary-in-fragment`;
        const oversized = goldenCase(
          '§6.1 oversized RichContent (kind of 33 characters) is dropped whole → generic'
        );
        receive(
          [
            {
              ...toPreview(JSON.parse(oversized.preview), { withImage: true }),
              url,
            },
          ],
          `see ${url}`
        );
        const shell = goldenCase(
          '§6.1 brand-tier platform claiming a structured card with attrs → brand, no attrs'
        );
        receive(
          [toPreview(JSON.parse(shell.preview), { withImage: true })],
          shell.body
        );
        assert.isAbove(lines.length, 0, 'something was logged');
        for (const line of lines) {
          assert.notInclude(line.toLowerCase(), 'canary', line);
          assert.notInclude(line, 'https://', line);
        }
      } finally {
        setOnLogCallback(() => undefined);
      }
    });
  });
});
