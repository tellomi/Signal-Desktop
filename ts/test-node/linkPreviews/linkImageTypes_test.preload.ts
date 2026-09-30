// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { LINK_IMAGE_CONTENT_TYPES } from '../../linkPreviews/linkImageTypes.std.ts';
import type { LinkFetchRequest } from '../../linkPreviews/linkFetchTypes.std.ts';
import { processLinkPreviewImageBytes } from '../../linkPreviews/linkPreviewFetch.preload.ts';
import type { LinkJobLike } from '../../linkPreviews/linkSendJob.std.ts';
import { runLinkSendJob } from '../../linkPreviews/linkSendJob.std.ts';
import { IMAGE_ICO } from '../../types/MIME.std.ts';
import { drop } from '../../util/drop.std.ts';
import type { scaleImageToLevel } from '../../util/scaleImageToLevel.preload.ts';

// ADR-0063 §4.4 (audit S2): the send job lets the fetcher bring back `image/x-icon` and
// `image/vnd.microsoft.icon`, the IANA name of the same format; the image check after it took only
// the first, so a favicon a server labelled by the book cost the "+1 image request" and was then
// thrown away, and the icon fallback silently showed no picture. The two now agree.

const BYTES = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);

// Stands for the canvas that decodes and re-encodes a picture, which does not exist under node:
// it says what it was given.
const given: Array<Parameters<typeof scaleImageToLevel>[0]> = [];
const scale: typeof scaleImageToLevel = async args => {
  given.push(args);
  return {
    blob: new Blob([new Uint8Array([9, 9, 9])], { type: args.contentType }),
    contentType: args.contentType,
  };
};

// What the picture is read back with (`blob-util` uses `FileReader`, a browser API).
class TestFileReader {
  result: ArrayBuffer | null = null;

  onloadend: (() => void) | null = null;

  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    drop(this.#read(blob));
  }

  async #read(blob: Blob): Promise<void> {
    try {
      this.result = await blob.arrayBuffer();
    } catch (error) {
      this.onerror?.(error);
      return;
    }
    this.onloadend?.();
  }
}

describe('the picture types of a link preview', () => {
  let hadFileReader: boolean;
  let savedFileReader: unknown;

  before(() => {
    hadFileReader = 'FileReader' in globalThis;
    savedFileReader = (globalThis as { FileReader?: unknown }).FileReader;
    // Not enumerable, so that the leak check of the test runner does not take it for a leak.
    Object.defineProperty(globalThis, 'FileReader', {
      value: TestFileReader,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  });

  after(() => {
    if (hadFileReader) {
      Object.defineProperty(globalThis, 'FileReader', {
        value: savedFileReader,
        configurable: true,
        writable: true,
        enumerable: false,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'FileReader');
    }
  });

  beforeEach(() => {
    given.length = 0;
  });

  it('are taken by the image check as the send job asks for them', async () => {
    assert.isAbove(LINK_IMAGE_CONTENT_TYPES.length, 0);
    for (const type of LINK_IMAGE_CONTENT_TYPES) {
      // eslint-disable-next-line no-await-in-loop
      const image = await processLinkPreviewImageBytes(BYTES, type, scale);
      assert.isNotNull(image, `${type} is fetched and then taken`);
    }
  });

  it('take an icon labelled by its IANA name as the icon labelled the usual way', async () => {
    const iana = await processLinkPreviewImageBytes(
      BYTES,
      'image/vnd.microsoft.icon',
      scale
    );
    const usual = await processLinkPreviewImageBytes(
      BYTES,
      'image/x-icon',
      scale
    );
    assert.isNotNull(iana);
    assert.isNotNull(usual);
    assert.deepEqual(
      given.map(args => args.contentType),
      [IMAGE_ICO, IMAGE_ICO],
      'one name reaches the rest of the app, not two'
    );
    assert.strictEqual(iana?.contentType, IMAGE_ICO);
    assert.strictEqual(usual?.contentType, IMAGE_ICO);
  });

  it('take the name in any case and with parameters, as a header has it', async () => {
    const image = await processLinkPreviewImageBytes(
      BYTES,
      'Image/VND.Microsoft.Icon; charset=binary',
      scale
    );
    assert.isNotNull(image);
  });

  it('leave out what is not a picture a preview shows', async () => {
    for (const type of [
      'image/svg+xml',
      'text/html',
      'application/octet-stream',
      'image/vnd.microsoft.icon.evil',
      '',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const image = await processLinkPreviewImageBytes(BYTES, type, scale);
      assert.isNull(image, type);
    }
    assert.lengthOf(given, 0, 'never decoded');
  });

  it('are what the send job asks the fetcher for, and a favicon it gets under the IANA name is kept', async () => {
    const requests: Array<LinkFetchRequest> = [];
    let imageKept: boolean | undefined;
    const job: LinkJobLike = {
      nextRequest: (() => {
        let done = false;
        return () => {
          if (done) {
            return null;
          }
          done = true;
          return JSON.stringify({
            id: 1,
            type: 'image',
            url: 'https://www.example.com/favicon.ico',
            user_agent: 'WhatsApp/2',
            max_redirects: 5,
            connect_timeout_ms: 5000,
            timeout_ms: 10_000,
          });
        };
      })(),
      onResponse: () => undefined,
      onNetworkError: () => undefined,
      onFailure: () => undefined,
      onFirstParty: () => undefined,
      onImage: (_id, ok) => {
        imageKept = ok;
      },
      finish: () =>
        JSON.stringify({
          level: 'generic',
          provider: null,
          route: null,
          kind: null,
          preview: null,
          group_link_invalid: false,
          lookalike: null,
          newly_unreachable_hosts: [],
          failures: [],
        }),
    };
    await runLinkSendJob(
      'https://www.example.com/',
      { unreachableHosts: [], expandShortLinks: false, locale: 'en' },
      {
        begin: () => job,
        fetch: async request => {
          requests.push(request);
          return {
            type: 'response',
            status: 200,
            finalUrl: 'https://www.example.com/favicon.ico',
            // A server that labels its favicon by the book.
            contentType: 'image/vnd.microsoft.icon',
            location: null,
            body: BYTES,
            redirects: 0,
          };
        },
        firstParty: async () => ({ ok: false }),
        acceptImage: async (body, contentType) =>
          (await processLinkPreviewImageBytes(body, contentType, scale)) !=
          null,
        now: Date.now,
      }
    );

    assert.lengthOf(requests, 1);
    const [request] = requests;
    assert.strictEqual(request?.kind, 'image');
    assert.sameMembers(
      [...(request?.contentTypes ?? [])],
      [...LINK_IMAGE_CONTENT_TYPES]
    );
    assert.isTrue(imageKept, 'the favicon is kept');
  });
});
