// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  getBodyWithHttpsLink,
  getHttpsUpgrade,
} from '../../linkPreviews/linkHttpsUpgrade.std.ts';

// owner 2026-10-17 (ADR-0063 §5.6): http:// and scheme-less links get a card over https when the
// registry claims the https link. Same cases as iOS `LinkValidatorTest` / `TellomiLinkClassifierTest`
// and Android `TellomiLinkHttpsUpgradeTest`.

describe('linkHttpsUpgrade', () => {
  const upgrade = (link: string, claimed = true) =>
    getHttpsUpgrade(link, () => claimed);
  const body = (
    text: string,
    previewUrl = 'https://b23.tv/abc',
    claimed = true
  ) => getBodyWithHttpsLink(text, previewUrl, () => claimed);

  describe('getHttpsUpgrade', () => {
    it('previews an http or scheme-less link the registry claims over https', () => {
      assert.strictEqual(upgrade('http://b23.tv/abc'), 'https://b23.tv/abc');
      assert.strictEqual(upgrade('HTTP://b23.tv/abc'), 'https://b23.tv/abc');
      assert.strictEqual(upgrade('b23.tv/abc'), 'https://b23.tv/abc');
      assert.strictEqual(
        upgrade('www.bilibili.com/video/BV1GJ411x7h7'),
        'https://www.bilibili.com/video/BV1GJ411x7h7'
      );
    });

    it('upgrades nothing else', () => {
      assert.isUndefined(upgrade('http://b23.tv/abc', false));
      assert.isUndefined(
        upgrade('https://b23.tv/abc'),
        'already https: Signal handles it'
      );
      assert.isUndefined(upgrade('ftp://b23.tv/abc'));
      assert.isUndefined(upgrade('http://'));
      assert.isUndefined(
        upgrade('http://example.org/a'),
        "Signal's own rules still apply"
      );
      assert.isUndefined(
        upgrade('me@b23.tv'),
        'an email address is not a page'
      );
      assert.isUndefined(upgrade('http://user:pw@b23.tv/abc'));
    });

    it('asks the registry about the https link only', () => {
      const asked = new Array<string>();
      getHttpsUpgrade('http://b23.tv/abc', url => {
        asked.push(url);
        return true;
      });
      getHttpsUpgrade('https://b23.tv/abc', url => {
        asked.push(url);
        return true;
      });
      assert.deepEqual(asked, ['https://b23.tv/abc']);
    });
  });

  describe('getBodyWithHttpsLink', () => {
    it('spells the claimed link https in the body given to rust/links', () => {
      assert.strictEqual(
        body('看 http://b23.tv/abc 很好'),
        '看 https://b23.tv/abc 很好'
      );
      assert.strictEqual(body('看 HTTP://b23.tv/abc'), '看 https://b23.tv/abc');
      assert.strictEqual(
        body('看 b23.tv/abc 很好'),
        '看 https://b23.tv/abc 很好'
      );
      assert.strictEqual(
        body('看这个b23.tv/abc很好'),
        '看这个https://b23.tv/abc很好'
      );
      assert.strictEqual(body('（b23.tv/abc）'), '（https://b23.tv/abc）');
      assert.strictEqual(
        body('b23.tv/abc', 'https://b23.tv/abc/'),
        'https://b23.tv/abc',
        "as rust/links: the preview URL's trailing slash may be missing"
      );
      assert.strictEqual(
        body('evil-b23.tv/abc 和 b23.tv/abc'),
        'evil-b23.tv/abc 和 https://b23.tv/abc'
      );
      assert.strictEqual(
        body('b23.tv/abcdef 和 b23.tv/abc'),
        'https://b23.tv/abcdef 和 https://b23.tv/abc',
        'every occurrence; rust/links says which one ends the link'
      );
    });

    it('leaves everything else alone', () => {
      assert.strictEqual(
        body('看 b23.tv/abc', undefined, false),
        '看 b23.tv/abc'
      );
      assert.strictEqual(
        body('看 https://b23.tv/abc'),
        '看 https://b23.tv/abc'
      );
      assert.strictEqual(body('evil-b23.tv/abc'), 'evil-b23.tv/abc');
      assert.strictEqual(body('xb23.tv/abc'), 'xb23.tv/abc');
      assert.strictEqual(body('me@b23.tv/abc'), 'me@b23.tv/abc');
      assert.strictEqual(body('ftp://b23.tv/abc'), 'ftp://b23.tv/abc');
      assert.strictEqual(
        body('https://x.com/b23.tv/abc'),
        'https://x.com/b23.tv/abc'
      );
      assert.strictEqual(body('没有链接'), '没有链接');
      assert.strictEqual(
        body('http://b23.tv/abc', 'http://b23.tv/abc'),
        'http://b23.tv/abc'
      );
    });

    it('asks the registry only when there is something to upgrade', () => {
      const asked = new Array<string>();
      const claims = (url: string) => {
        asked.push(url);
        return true;
      };
      getBodyWithHttpsLink(
        '看 https://b23.tv/abc',
        'https://b23.tv/abc',
        claims
      );
      getBodyWithHttpsLink('没有链接', 'https://b23.tv/abc', claims);
      assert.deepEqual(asked, []);
      getBodyWithHttpsLink(
        'b23.tv/abc http://b23.tv/abc',
        'https://b23.tv/abc',
        claims
      );
      assert.deepEqual(asked, ['https://b23.tv/abc']);
    });
  });
});
