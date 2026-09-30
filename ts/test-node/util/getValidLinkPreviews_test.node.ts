// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { ReceivedLinkPreviewDecisionType } from '../../linkPreviews/linkCard.std.ts';
import type { LinkPreviewType } from '../../types/message/LinkPreviews.std.ts';
import { IMAGE_JPEG } from '../../types/MIME.std.ts';
import { getValidLinkPreviews } from '../../util/getValidLinkPreviews.node.ts';
import { callLinkRootKeyToUrl } from '../../util/callLinkRootKeyToUrl.std.ts';
import { FAKE_CALL_LINK } from '../../test-helpers/fakeCallLink.std.ts';

describe('getValidLinkPreviews', () => {
  function composePreview(url: string): LinkPreviewType {
    return { url, title: 'Title', description: 'Description' };
  }

  it('keeps an https preview whose url appears in the body', () => {
    const result = getValidLinkPreviews(
      [composePreview('https://signal.org')],
      'Check this out: https://signal.org today',
      { isStory: false }
    );
    assert.lengthOf(result, 1);
    assert.exists(result[0]);
    assert.strictEqual(result[0].url, 'https://signal.org');
  });

  it('drops a preview whose url is absent from the body', () => {
    const result = getValidLinkPreviews(
      [composePreview('https://signal.org')],
      'There is no link in this body',
      { isStory: false }
    );
    assert.lengthOf(result, 0);
  });

  it('drops a non-https preview even when the url is in the body', () => {
    const result = getValidLinkPreviews(
      [composePreview('http://signal.org')],
      'Insecure link: http://signal.org',
      { isStory: false }
    );
    assert.lengthOf(result, 0);
  });

  it('exempts stories from the url-in-body requirement', () => {
    const result = getValidLinkPreviews(
      [composePreview('https://signal.org')],
      '',
      {
        isStory: true,
      }
    );
    assert.lengthOf(result, 1);
    assert.exists(result[0]);
    assert.strictEqual(result[0].url, 'https://signal.org');
  });

  it('call links also require url in the body', () => {
    const url = callLinkRootKeyToUrl(FAKE_CALL_LINK.rootKey);
    assert.exists(url);
    const result = getValidLinkPreviews([composePreview(url)], '', {
      isStory: false,
    });
    assert.lengthOf(result, 0);
  });

  it('keeps only the valid previews from a mixed list', () => {
    const result = getValidLinkPreviews(
      [
        composePreview('https://url-1.org'),
        composePreview('https://url-2.org'),
        composePreview('https://not-in-body.org'),
      ],
      'see https://url-1.org and https://url-2.org',
      { isStory: false }
    );
    assert.deepEqual(
      result.map(item => item.url),
      ['https://url-1.org', 'https://url-2.org']
    );
  });
  // Tellomi (ADR-0063 §5.1 rule 4, §7.4): rust/links' decision about a received preview, given by
  // the caller.
  describe('with a decision from rust/links', () => {
    const KEEP_ALL: ReceivedLinkPreviewDecisionType = {
      keepPreview: true,
      keepRich: true,
      keepImage: true,
    };
    const image = {
      contentType: IMAGE_JPEG,
      size: 1000,
      cdnKey: 'the-cdn-key',
    };
    const withExtras = (url: string): LinkPreviewType => ({
      ...composePreview(url),
      rich: 'cmljaA==',
      image,
    });

    it('is Signal’s own check when there is no decision', () => {
      const result = getValidLinkPreviews(
        [withExtras('https://signal.org'), withExtras('https://other.org')],
        'https://signal.org',
        { isStory: false, decide: () => undefined }
      );
      assert.deepEqual(
        result.map(item => item.url),
        ['https://signal.org']
      );
      assert.strictEqual(result[0]?.rich, 'cmljaA==');
      assert.deepEqual(result[0]?.image, image);
    });

    it('drops a preview the decision drops, although the URL is in the body', () => {
      const result = getValidLinkPreviews(
        [composePreview('https://signal.org')],
        'https://signal.org',
        {
          isStory: false,
          decide: () => ({ ...KEEP_ALL, keepPreview: false }),
        }
      );
      assert.lengthOf(result, 0);
    });

    it('takes the decision instead of the URL-in-body check', () => {
      // Signal alone wants the link exactly as it is in the body.
      const previews = [composePreview('https://signal.org')];
      const body = 'see https://signal.org/';
      assert.lengthOf(
        getValidLinkPreviews(previews, body, { isStory: false }),
        0
      );
      assert.lengthOf(
        getValidLinkPreviews(previews, body, {
          isStory: false,
          decide: () => KEEP_ALL,
        }),
        1
      );
      // It is asked once for each preview, with that preview.
      const asked: Array<string> = [];
      getValidLinkPreviews(
        [
          composePreview('https://url-1.org'),
          composePreview('https://url-2.org'),
        ],
        'x',
        {
          isStory: false,
          decide: item => {
            asked.push(item.url);
            return KEEP_ALL;
          },
        }
      );
      assert.deepEqual(asked, ['https://url-1.org', 'https://url-2.org']);
    });

    it('still applies Signal’s other checks: https, a domain that may have a preview', () => {
      for (const url of [
        'http://signal.org',
        'https://localhost/x',
        'https://a.example.com/x',
        'https://debuglogs.org/x',
        '',
      ]) {
        assert.lengthOf(
          getValidLinkPreviews([composePreview(url)], url, {
            isStory: false,
            decide: () => KEEP_ALL,
          }),
          0,
          url
        );
      }
    });

    it('drops only `rich` when told to, and leaves it exactly as received otherwise', () => {
      const [trimmed] = getValidLinkPreviews(
        [withExtras('https://signal.org')],
        'https://signal.org',
        { isStory: false, decide: () => ({ ...KEEP_ALL, keepRich: false }) }
      );
      assert.notProperty(trimmed, 'rich');
      assert.strictEqual(trimmed?.title, 'Title');
      assert.strictEqual(trimmed?.description, 'Description');
      assert.deepEqual(trimmed?.image, image);

      const [kept] = getValidLinkPreviews(
        [withExtras('https://signal.org')],
        'https://signal.org',
        { isStory: false, decide: () => KEEP_ALL }
      );
      assert.strictEqual(kept?.rich, 'cmljaA==');
    });

    it('drops only the picture when told to', () => {
      const [trimmed] = getValidLinkPreviews(
        [withExtras('https://signal.org')],
        'https://signal.org',
        { isStory: false, decide: () => ({ ...KEEP_ALL, keepImage: false }) }
      );
      assert.notProperty(trimmed, 'image');
      assert.strictEqual(trimmed?.rich, 'cmljaA==');
      assert.strictEqual(trimmed?.title, 'Title');
    });

    it('does not touch the preview it was given', () => {
      const original = withExtras('https://signal.org');
      getValidLinkPreviews([original], 'https://signal.org', {
        isStory: false,
        decide: () => ({ ...KEEP_ALL, keepRich: false, keepImage: false }),
      });
      assert.strictEqual(original.rich, 'cmljaA==');
      assert.deepEqual(original.image, image);
    });

    it('marks a call link as before', () => {
      const url = callLinkRootKeyToUrl(FAKE_CALL_LINK.rootKey);
      assert.exists(url);
      const [result] = getValidLinkPreviews([composePreview(url)], url, {
        isStory: false,
        decide: () => ({ ...KEEP_ALL, keepImage: false }),
      });
      assert.isTrue(result?.isCallLink);
      assert.exists(result?.callLinkRoomId);
    });
  });
});
