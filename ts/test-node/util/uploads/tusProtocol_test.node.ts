// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// oxlint-disable-next-line typescript/no-restricted-imports
import { assert, expect } from 'chai';
import { Readable } from 'node:stream';
import { Headers, Response } from 'node-fetch';
import * as sinon from 'sinon';
import {
  _getUploadMetadataHeader,
  _tusCreateWithUploadRequest,
  _tusGetCurrentOffsetRequest,
  _tusResumeUploadRequest,
  tusResumeUpload,
  tusUpload,
  type FetchFunctionType,
  type TusFileReader,
} from '../../../util/uploads/tusProtocol.node.ts';
import { TestServer, body } from './helpers.node.ts';
import { toLogFormat } from '../../../types/errors.std.ts';
import { MINUTE } from '../../../util/durations/index.std.ts';

describe('tusProtocol', () => {
  describe('_getUploadMetadataHeader', () => {
    it('creates key value pairs, with base 64 values', () => {
      assert.strictEqual(_getUploadMetadataHeader({}), '');
      assert.strictEqual(
        _getUploadMetadataHeader({
          one: 'first',
        }),
        'one Zmlyc3Q='
      );
      assert.strictEqual(
        _getUploadMetadataHeader({
          one: 'first',
          two: 'second',
        }),
        'one Zmlyc3Q=,two c2Vjb25k'
      );
    });
  });

  describe('_tusCreateWithUploadRequest', () => {
    let server: TestServer;

    beforeEach(async () => {
      server = new TestServer();
      await server.listen();
    });

    afterEach(async () => {
      await server.closeServer();
    });

    it('uploads on create', async () => {
      server.respondWith(200, {});
      const result = await _tusCreateWithUploadRequest({
        endpoint: server.endpoint,
        headers: {
          'custom-header': 'custom-value',
        },
        fileName: 'test',
        fileSize: 6,
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          yield new Uint8Array([4, 5, 6]);
        }),
      });
      assert.strictEqual(result, true);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 6);
      assert.strictEqual(
        server.lastRequest()?.body.toString('hex'),
        '010203040506'
      );
      assert.strictEqual(server.lastRequest()?.method, 'POST');
      assert.deepOwnInclude(server.lastRequest()?.headers, {
        'tus-resumable': '1.0.0',
        'upload-length': '6',
        'upload-metadata': 'filename dGVzdA==',
        'content-type': 'application/offset+octet-stream',
        'custom-header': 'custom-value',
      });
    });

    it('gracefully handles server connection closing', async () => {
      const result = await _tusCreateWithUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        fileSize: 0,
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          await server.closeServer();
          yield new Uint8Array([4, 5, 6]);
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 3);
      assert.strictEqual(server.lastRequest()?.body.toString('hex'), '010203');
    });

    it('gracefully handles being aborted', async () => {
      const controller = new AbortController();
      const result = await _tusCreateWithUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        fileSize: 0,
        signal: controller.signal,
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          controller.abort();
          yield new Uint8Array([4, 5, 6]);
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 3);
      assert.strictEqual(server.lastRequest()?.body.toString('hex'), '010203');
    });

    it('reports progress', async () => {
      let progress = 0;
      const result = await _tusCreateWithUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        fileSize: 6,
        onProgress: bytesUploaded => {
          progress = bytesUploaded;
        },
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          assert.strictEqual(progress, 3);
          yield new Uint8Array([4, 5, 6]);
          assert.strictEqual(progress, 6);
        }),
      });
      assert.strictEqual(result, true);
    });

    it('reports caught errors', async () => {
      let caughtError: Error | undefined;
      const result = await _tusCreateWithUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        fileSize: 6,
        onCaughtError: error => {
          caughtError = error;
        },
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          throw new Error('test');
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(caughtError?.message, 'test');
    });
  });

  describe('_tusGetCurrentOffsetRequest', () => {
    let server: TestServer;

    beforeEach(async () => {
      server = new TestServer();
      await server.listen();
    });

    afterEach(async () => {
      await server.closeServer();
    });

    it('returns the current offset', async () => {
      server.respondWith(200, { 'Upload-Offset': '3' });
      const result = await _tusGetCurrentOffsetRequest({
        endpoint: server.endpoint,
        headers: {
          'custom-header': 'custom-value',
        },
        fileName: 'test',
      });
      assert.strictEqual(result, 3);
      assert.strictEqual(server.lastRequest()?.method, 'HEAD');
      assert.deepOwnInclude(server.lastRequest()?.headers, {
        'tus-resumable': '1.0.0',
        'custom-header': 'custom-value',
      });
    });

    it('throws on missing offset', async () => {
      server.respondWith(200, {});
      await assert.isRejected(
        _tusGetCurrentOffsetRequest({
          endpoint: server.endpoint,
          headers: {},
          fileName: 'test',
        }),
        'getCurrentState: Missing Upload-Offset header'
      );
    });

    it('throws on invalid offset', async () => {
      server.respondWith(200, { 'Upload-Offset': '-1' });
      await assert.isRejected(
        _tusGetCurrentOffsetRequest({
          endpoint: server.endpoint,
          headers: {},
          fileName: 'test',
        }),
        'getCurrentState: Invalid Upload-Offset (-1)'
      );
    });
  });

  describe('_tusResumeUploadRequest', () => {
    let server: TestServer;

    beforeEach(async () => {
      server = new TestServer();
      await server.listen();
    });

    afterEach(async () => {
      await server.closeServer();
    });

    it('uploads on resume', async () => {
      server.respondWith(200, {});
      const result = await _tusResumeUploadRequest({
        endpoint: server.endpoint,
        headers: {
          'custom-header': 'custom-value',
        },
        fileName: 'test',
        uploadOffset: 3,
        readable: body(server, async function* () {
          // we're resuming from offset 3
          yield new Uint8Array([3, 4, 5]);
          yield new Uint8Array([6, 7, 8]);
        }),
      });
      assert.strictEqual(result, true);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 6);
      assert.strictEqual(
        server.lastRequest()?.body.toString('hex'),
        '030405060708'
      );
      assert.deepOwnInclude(server.lastRequest()?.headers, {
        'tus-resumable': '1.0.0',
        'upload-offset': '3',
        'content-type': 'application/offset+octet-stream',
        'custom-header': 'custom-value',
      });
    });

    it('gracefully handles server connection closing', async () => {
      const result = await _tusResumeUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        uploadOffset: 3,
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          await server.closeServer();
          yield new Uint8Array([4, 5, 6]);
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 3);
      assert.strictEqual(server.lastRequest()?.body.toString('hex'), '010203');
    });

    it('gracefully handles being aborted', async () => {
      const controller = new AbortController();
      const result = await _tusResumeUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        uploadOffset: 3,
        signal: controller.signal,
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          controller.abort();
          yield new Uint8Array([4, 5, 6]);
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(server.lastRequest()?.body.byteLength, 3);
      assert.strictEqual(server.lastRequest()?.body.toString('hex'), '010203');
    });

    it('reports progress', async () => {
      let progress = 0;
      const result = await _tusResumeUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        uploadOffset: 3,
        onProgress: bytesUploaded => {
          progress = bytesUploaded;
        },
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          assert.strictEqual(progress, 3);
          yield new Uint8Array([4, 5, 6]);
          assert.strictEqual(progress, 6);
        }),
      });
      assert.strictEqual(result, true);
    });

    it('reports caught errors', async () => {
      let caughtError: Error | undefined;
      const result = await _tusResumeUploadRequest({
        endpoint: server.endpoint,
        headers: {},
        fileName: 'test',
        uploadOffset: 3,
        onCaughtError: error => {
          caughtError = error;
        },
        readable: body(server, async function* () {
          yield new Uint8Array([1, 2, 3]);
          throw new Error('test');
        }),
      });
      assert.strictEqual(result, false);
      assert.strictEqual(caughtError?.message, 'test');
    });
  });

  describe('tusUpload', () => {
    let server: TestServer;

    function assertSocketCloseError(error: unknown) {
      // There isn't an equivalent to this chain in assert()
      expect(error, toLogFormat(error))
        .property('code')
        .oneOf(['ECONNRESET', 'UND_ERR_SOCKET']);
    }

    beforeEach(async () => {
      server = new TestServer();
      await server.listen();
    });

    afterEach(async () => {
      await server.closeServer();
    });

    it('creates and uploads', async () => {
      server.respondWith(200, {});
      await tusUpload({
        endpoint: server.endpoint,
        headers: { 'mock-header': 'mock-value' },
        fileName: 'mock-file-name',
        filePath: 'mock-file-path',
        fileSize: 6,
        onCaughtError: assertSocketCloseError,
        reader: (filePath, offset) => {
          assert.strictEqual(offset, undefined);
          assert.strictEqual(filePath, 'mock-file-path');
          return body(server, async function* () {
            yield new Uint8Array([1, 2, 3]);
            yield new Uint8Array([4, 5, 6]);
          });
        },
      });
      assert.strictEqual(server.lastRequest()?.body.byteLength, 6);
      assert.deepOwnInclude(server.lastRequest()?.headers, {
        'upload-metadata': 'filename bW9jay1maWxlLW5hbWU=',
        'mock-header': 'mock-value',
      });
    });

    it('resumes when initial request fails', async () => {
      let cursor = undefined as number | void;
      let callCount = 0;
      const file = new Uint8Array([1, 2, 3, 4, 5, 6]);
      await tusUpload({
        endpoint: server.endpoint,
        headers: { 'mock-header': 'mock-value' },
        fileName: 'mock-file-name',
        filePath: 'mock-file-path',
        fileSize: file.byteLength,
        onCaughtError: assertSocketCloseError,
        reader: (_filePath, offset) => {
          callCount += 1;
          assert.strictEqual(offset, cursor);
          if (offset != null) {
            // Ensure we're checking the offset on the HEAD request on every
            // iteration after the first.
            assert.strictEqual(server.lastRequest()?.method, 'HEAD');
          }
          return body(server, async function* () {
            cursor ??= 0;
            const nextChunk = file.subarray(cursor, (cursor += 2));
            if (offset === undefined) {
              // Stage 1: Create and upload
              yield nextChunk;
              server.closeLastRequest();
              assert.deepOwnInclude(server.lastRequest(), {
                method: 'POST',
                body: nextChunk,
              });
            } else if (offset === 2) {
              // Stage 2: Resume
              yield nextChunk;
              server.closeLastRequest();
              assert.deepOwnInclude(server.lastRequest(), {
                method: 'PATCH',
                body: nextChunk,
              });
            } else if (offset === 4) {
              // Stage 3: Keep looping
              yield nextChunk;
              // Closing even though this is the last one so we have to check
              // HEAD one last time.
              server.closeLastRequest();
              assert.deepOwnInclude(server.lastRequest(), {
                method: 'PATCH',
                body: nextChunk,
              });
            } else {
              assert.fail('Unexpected offset');
            }
            server.respondWith(200, { 'Upload-Offset': cursor });
          });
        },
      });
      // Last request should have checked length and seen it was done.
      assert.strictEqual(server.lastRequest()?.method, 'HEAD');
      assert.strictEqual(callCount, 3);
    });

    it('should resume from wherever the server says it got to', async () => {
      let nextExpectedOffset = undefined as number | void;
      let callCount = 0;
      const file = new Uint8Array([1, 2, 3, 4, 5, 6]);
      await tusUpload({
        endpoint: server.endpoint,
        headers: { 'mock-header': 'mock-value' },
        fileName: 'mock-file-name',
        filePath: 'mock-file-path',
        fileSize: file.byteLength,
        onCaughtError: assertSocketCloseError,
        reader: (_filePath, offset) => {
          callCount += 1;
          assert.strictEqual(offset, nextExpectedOffset);
          return body(server, async function* () {
            if (offset === undefined) {
              yield file.subarray(0, 3);
              yield file.subarray(3, 6);
              nextExpectedOffset = 3;
              server.closeLastRequest();
              // For this test lets pretend this as far as we were able to save
              server.respondWith(200, { 'Upload-Offset': 3 });
            } else if (offset === 3) {
              yield file.subarray(3, 6);
            } else {
              assert.fail('Unexpected offset');
            }
          });
        },
      });
      assert.strictEqual(callCount, 2);
    });
  });

  describe('retries exhausted', () => {
    type FakeCall = { method: string; uploadOffset: string | null };

    const FILE = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const params = {
      endpoint: 'https://cdn.example.test/upload/attachments',
      headers: {},
      fileName: 'mock-file-name',
      filePath: 'mock-file-path',
      fileSize: FILE.byteLength,
      maxRetries: 3,
    };
    const socketError = () => new Error('socket hang up');

    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      // Only the backoff sleeps; streams and promises keep their real timing.
      clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      sandbox.restore();
    });

    // Stands in for the tus endpoint at the `fetchFn` boundary. The last entry
    // of each list repeats once the list runs out. A 'transport-error' PATCH
    // rejects like a dropped socket, which `_tusResumeUploadRequest` reports as
    // `false` rather than throwing. POST always drops, as in a failed create.
    function createFakeTus({
      headOffsets,
      patchOutcomes,
    }: {
      headOffsets: ReadonlyArray<number>;
      patchOutcomes: ReadonlyArray<'ok' | 'transport-error'>;
    }) {
      const calls = new Array<FakeCall>();
      let headCount = 0;
      let patchCount = 0;

      const fetchFn: FetchFunctionType = async (_url, init) => {
        const { method = 'GET' } = init;
        calls.push({
          method,
          uploadOffset: new Headers(init.headers).get('Upload-Offset'),
        });

        switch (method) {
          case 'HEAD': {
            const offset =
              headOffsets[Math.min(headCount, headOffsets.length - 1)];
            headCount += 1;
            return new Response(undefined, {
              status: 200,
              headers: { 'Upload-Offset': String(offset) },
            });
          }
          case 'PATCH': {
            const outcome =
              patchOutcomes[Math.min(patchCount, patchOutcomes.length - 1)];
            patchCount += 1;
            if (outcome === 'transport-error') {
              throw socketError();
            }
            return new Response(undefined, { status: 204 });
          }
          case 'POST':
            throw socketError();
          default:
            throw new Error(`Unexpected ${method} request`);
        }
      };

      return {
        fetchFn,
        countOf: (method: string) => calls.filter(c => c.method === method),
      };
    }

    function createReader() {
      const offsets = new Array<number | undefined>();
      const reader: TusFileReader = (_filePath, offset) => {
        offsets.push(offset);
        return Readable.from([FILE.subarray(offset ?? 0)]);
      };
      return { reader, offsets };
    }

    it('rejects when every PATCH fails at the transport level', async () => {
      const fake = createFakeTus({
        headOffsets: [0],
        patchOutcomes: ['transport-error'],
      });
      const { reader } = createReader();
      const caught = new Array<Error>();

      const result = assert.isRejected(
        tusResumeUpload({
          ...params,
          reader,
          fetchFn: fake.fetchFn,
          onCaughtError: error => caught.push(error),
        }),
        /upload incomplete after 3 attempts/
      );
      await clock.tickAsync(MINUTE);
      await result;

      // It really did retry before giving up.
      assert.lengthOf(fake.countOf('HEAD'), 3);
      assert.lengthOf(fake.countOf('PATCH'), 3);
      assert.lengthOf(caught, 3);
    });

    it('resolves when a PATCH succeeds after one transport failure', async () => {
      const fake = createFakeTus({
        // The dropped PATCH got 3 bytes across before dying.
        headOffsets: [0, 3],
        patchOutcomes: ['transport-error', 'ok'],
      });
      const { reader, offsets } = createReader();

      const result = assert.isFulfilled(
        tusResumeUpload({ ...params, reader, fetchFn: fake.fetchFn })
      );
      await clock.tickAsync(MINUTE);
      await result;

      assert.deepStrictEqual(
        fake.countOf('PATCH').map(c => c.uploadOffset),
        ['0', '3']
      );
      assert.deepStrictEqual(offsets, [0, 3]);
    });

    it('resolves when only the final attempt succeeds', async () => {
      const fake = createFakeTus({
        headOffsets: [0],
        patchOutcomes: ['transport-error', 'transport-error', 'ok'],
      });
      const { reader } = createReader();

      const result = assert.isFulfilled(
        tusResumeUpload({ ...params, reader, fetchFn: fake.fetchFn })
      );
      await clock.tickAsync(MINUTE);
      await result;

      assert.lengthOf(fake.countOf('PATCH'), 3);
    });

    it('resolves without a PATCH when the server already has the whole file', async () => {
      const fake = createFakeTus({
        headOffsets: [FILE.byteLength],
        patchOutcomes: ['transport-error'],
      });
      const { reader, offsets } = createReader();

      const result = assert.isFulfilled(
        tusResumeUpload({ ...params, reader, fetchFn: fake.fetchFn })
      );
      await clock.tickAsync(MINUTE);
      await result;

      assert.lengthOf(fake.countOf('HEAD'), 1);
      assert.lengthOf(fake.countOf('PATCH'), 0);
      assert.isEmpty(offsets);
    });

    it('tusUpload rejects when the create and every resume all fail', async () => {
      const fake = createFakeTus({
        headOffsets: [0],
        patchOutcomes: ['transport-error'],
      });
      const { reader } = createReader();

      const result = assert.isRejected(
        tusUpload({
          ...params,
          reader,
          fetchFn: fake.fetchFn,
          filePath: 'mock-file-path',
        }),
        /upload incomplete after 3 attempts/
      );
      await clock.tickAsync(MINUTE);
      await result;

      assert.lengthOf(fake.countOf('POST'), 1);
      assert.lengthOf(fake.countOf('PATCH'), 3);
    });
  });
});
