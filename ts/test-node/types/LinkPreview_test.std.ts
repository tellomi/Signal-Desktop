// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  cutAtIriTerminator,
  findLinkifiableLinks,
  findLinks,
  getLinkifiableLength,
  isPreviewOfHiddenCharacterLink,
  isValidLinkPreviewForBody,
  isLinkSneaky,
  isValidLink,
  shouldLinkifyMessage,
  shouldPreviewHref,
} from '../../types/LinkPreview.std.ts';

describe('Link previews', () => {
  describe('#isValidLink', () => {
    it('returns false for random, non-https URLs', () => {
      assert.isFalse(isValidLink(''));
      assert.isFalse(isValidLink('signal.com'));
      assert.isFalse(isValidLink('signal.org'));
      assert.isFalse(isValidLink('https'));
      assert.isFalse(isValidLink('https://'));
      assert.isFalse(isValidLink('https://bad url'));
      assert.isFalse(isValidLink('http://signal.org'));
    });

    it('returns true for https:// URLs', () => {
      assert.isTrue(isValidLink('https://signal.org'));
      assert.isTrue(isValidLink('https://somewhere.someplace.signal.org/'));
      assert.isTrue(isValidLink('https://signal.org/something/another/#thing'));
      assert.isTrue(
        isValidLink(
          'https://signal.org/something/another/?one=two&three=four#thing'
        )
      );
    });
  });

  describe('#shouldPreviewHref', () => {
    it('returns false for invalid URLs', () => {
      assert.isFalse(shouldPreviewHref(''));
      assert.isFalse(shouldPreviewHref('https'));
      assert.isFalse(shouldPreviewHref('https://'));
      assert.isFalse(shouldPreviewHref('https://bad url'));
      assert.isFalse(shouldPreviewHref('signal.com'));
      assert.isFalse(shouldPreviewHref('signal.org'));
    });

    it('returns false for non-HTTPS URLs', () => {
      assert.isFalse(shouldPreviewHref('http://signal.org'));
      assert.isFalse(shouldPreviewHref('ftp://signal.org'));
      assert.isFalse(shouldPreviewHref('file://signal'));
    });

    it('returns false if the link is "sneaky"', () => {
      // See `isLinkSneaky` tests below for more thorough checking.
      assert.isFalse(shouldPreviewHref('https://user:pass@signal.org'));
      assert.isFalse(shouldPreviewHref('https://aquí.signal'));
      assert.isFalse(shouldPreviewHref('https://aqu%C3%AD.signal'));
    });

    it('returns false for skipped domains', () => {
      assert.isFalse(shouldPreviewHref('https://debuglogs.org'));
      assert.isFalse(shouldPreviewHref('https://example.com'));
      assert.isFalse(shouldPreviewHref('https://new.example'));
      assert.isFalse(shouldPreviewHref('https://onion'));
      assert.isFalse(shouldPreviewHref('https://bloomin.onion'));
      assert.isFalse(shouldPreviewHref('https://localhost'));
      assert.isFalse(shouldPreviewHref('https://localhost:8080'));
      assert.isFalse(shouldPreviewHref('https://abcd.test'));
    });

    // Tellomi, PM 2026-10-19 (ADR-0063 §5.6): Chinese in the path, query or fragment gets a
    // preview, as on Telegram.
    it('returns true for visible non-ASCII text after the host', () => {
      assert.isTrue(shouldPreviewHref('https://zh.wikipedia.org/wiki/中国'));
      assert.isTrue(shouldPreviewHref('https://www.baidu.com/s?wd=天气'));
      assert.isTrue(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中国#历史')
      );
      assert.isTrue(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/%E4%B8%AD国')
      );
      assert.isTrue(shouldPreviewHref('https://signal.org/aquí-está'));
    });

    it('returns false for hidden characters or spaces after the host', () => {
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中\u200b国')
      );
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中\u2066国')
      );
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中\u00ad国')
      );
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中\u3000国')
      );
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中\ue000国')
      );
      assert.isFalse(
        shouldPreviewHref('https://zh.wikipedia.org/wiki/中国，好')
      );
      assert.isFalse(shouldPreviewHref('https://signal.org/hello world'));
      assert.isFalse(shouldPreviewHref('https://signal.org/a"b中'));
      assert.isFalse(shouldPreviewHref('https://signal.org/\u2500中'));
      assert.isFalse(shouldPreviewHref('https://中国.signal.org/a'));
    });

    it('returns true for "safe" urls', () => {
      assert.isTrue(shouldPreviewHref('https://signal.org'));
      assert.isTrue(shouldPreviewHref('https://example.signal.org'));
      assert.isTrue(shouldPreviewHref('https://myexample.com'));
      assert.isTrue(
        shouldPreviewHref('https://signal.org/foo/bar?query=string#hash')
      );
    });
  });

  describe('#cutAtIriTerminator', () => {
    it('cuts at Chinese sentence punctuation and wide spaces after the host', () => {
      const cut = cutAtIriTerminator;
      assert.strictEqual(
        cut('https://zh.wikipedia.org/wiki/中国，很好'),
        'https://zh.wikipedia.org/wiki/中国'
      );
      assert.strictEqual(
        cut('https://zh.wikipedia.org/wiki/中国。'),
        'https://zh.wikipedia.org/wiki/中国'
      );
      assert.strictEqual(
        cut('https://www.baidu.com/s?wd=天气！'),
        'https://www.baidu.com/s?wd=天气'
      );
      assert.strictEqual(cut('https://a.org/中国」x'), 'https://a.org/中国');
      assert.strictEqual(cut('https://a.org/x\u3000y'), 'https://a.org/x');
      assert.strictEqual(
        cut('https://zh.wikipedia.org/wiki/中国'),
        'https://zh.wikipedia.org/wiki/中国'
      );
      assert.strictEqual(cut('https://a.org'), 'https://a.org');
      assert.strictEqual(cut('not a url，x'), 'not a url，x');
    });
  });

  describe('#getLinkifiableLength (Tellomi, PM 2026-10-19)', () => {
    const hidden = [
      '\u200b',
      '\u200c',
      '\u200d',
      '\u200e',
      '\u200f',
      '\u2060',
      '\u2061',
      '\u2062',
      '\u2063',
      '\u2064',
      '\u202a',
      '\u202b',
      '\u202c',
      '\u202d',
      '\u202e',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
      '\ufeff',
    ];

    it('is 0 for a link with a zero-width or bidi character in it (as linkify-it finds it)', () => {
      for (const ch of hidden) {
        assert.strictEqual(
          getLinkifiableLength(`https://signal.org/a${ch}b`),
          0,
          JSON.stringify(ch)
        );
        assert.strictEqual(
          getLinkifiableLength(`https://signal.org/abc${ch}`),
          0,
          JSON.stringify(ch)
        );
      }
      assert.strictEqual(
        getLinkifiableLength('https://signal.org/a,b\u200fc'),
        0
      );
      assert.strictEqual(
        getLinkifiableLength('https://en.wikipedia.org/wiki/F_(b)\u200b'),
        0
      );
      // A closing bracket with its opener in the link belongs to it (Android Linkifier)
      assert.strictEqual(
        getLinkifiableLength('https://signal.org/(abc)\u200b'),
        0
      );
      assert.strictEqual(
        getLinkifiableLength('https://signal.org/a/中\u200b文'),
        0
      );
    });

    it('leaves links without hidden characters exactly as they were', () => {
      for (const link of [
        'https://signal.org',
        'https://signal.org/abc',
        'https://zh.wikipedia.org/wiki/中国',
        'https://zh.wikipedia.org/wiki/中国，很好',
        'https://signal.org/%E4%B8%AD',
        'signal.org',
      ]) {
        assert.strictEqual(getLinkifiableLength(link), link.length, link);
      }
    });

    // PM 2026-10-19: the link ends at ASCII punctuation that ends a link; a hidden character after
    // it is not part of the link (Android Linkifier, iOS LinkValidator)
    it('stops at ASCII end punctuation when a hidden character follows it', () => {
      for (const [link, expected] of [
        ['https://signal.org/abc,\u200f next', 'https://signal.org/abc'],
        ['https://signal.org/abc,\u200f', 'https://signal.org/abc'],
        ['https://signal.org/abc!\u2060', 'https://signal.org/abc'],
        ['https://signal.org/abc.\u200e', 'https://signal.org/abc'],
        ['https://signal.org/abc?\u00ad', 'https://signal.org/abc'],
        ['https://signal.org/abc,.\u2060', 'https://signal.org/abc'],
        ['https://signal.org/abc,\u200fdef', 'https://signal.org/abc'],
        ['https://signal.org/abc)\u200b', 'https://signal.org/abc'],
        ['https://signal.org/(abc))\u200b', 'https://signal.org/(abc)'],
      ]) {
        assert.strictEqual(
          link?.slice(0, getLinkifiableLength(link ?? '')),
          expected,
          JSON.stringify(link)
        );
      }
    });

    it('stops at Chinese punctuation when a hidden character only follows it', () => {
      const link = 'https://zh.wikipedia.org/wiki/中国，\u200b很好';
      assert.strictEqual(
        link.slice(0, getLinkifiableLength(link)),
        'https://zh.wikipedia.org/wiki/中国'
      );
    });
  });

  describe('#findLinkifiableLinks (Tellomi, PM 2026-10-19)', () => {
    it('leaves out links with a hidden character, cut as they are shown', () => {
      assert.deepEqual(
        findLinkifiableLinks(
          'a https://signal.org/abc\ufeff b https://sig\u200bnal.org/x c https://signal.org/ok'
        ),
        ['https://signal.org/ok']
      );
      assert.deepEqual(
        findLinkifiableLinks('https://signal.org/abc,\u200f next'),
        ['https://signal.org/abc']
      );
      assert.deepEqual(
        findLinkifiableLinks('https://zh.wikipedia.org/wiki/中国，\u200b很好'),
        ['https://zh.wikipedia.org/wiki/中国']
      );
      assert.deepEqual(findLinkifiableLinks('see https://signal.org/abc'), [
        'https://signal.org/abc',
      ]);
    });
  });

  describe('#isPreviewOfHiddenCharacterLink (Tellomi, PM 2026-10-19)', () => {
    it('is true for a preview of a link with a hidden character in the body', () => {
      for (const [url, body] of [
        ['https://signal.org/abc', 'https://signal.org/abc\ufeff'],
        ['https://signal.org/abc', 'see https://signal.org/abc\u2060 next'],
        ['https://signal.org/abc', 'https://sig\u200bnal.org/abc'],
        ['https://sig\u200bnal.org/abc', 'https://sig\u200bnal.org/abc'],
        // where NSDataDetector ends such a link
        ['https://signal.org', 'https://signal.org/a\u2060b'],
        ['https://signal.org/', 'see https://signal.org/a\u2060b'],
        // glued to the start of a link
        ['https://signal.org/abc', '看 \u200bhttps://signal.org/abc'],
        ['https://signal.org/abc', '\ufeffhttps://signal.org/abc'],
      ]) {
        assert.isTrue(
          isPreviewOfHiddenCharacterLink(url ?? '', body),
          JSON.stringify([url, body])
        );
      }
    });

    it('is false for a preview of a clean link', () => {
      for (const [url, body] of [
        ['https://signal.org/abc', 'https://signal.org/abc'],
        ['https://signal.org/abc', 'https://signal.org/abc,\u200f next'],
        ['https://signal.org/abc', 'https://signal.org/abc!\u2060'],
        ['https://signal.org/abc', 'https://signal.org/abc.\u200e'],
        [
          'https://signal.org',
          'https://signal.org/a\u2060b https://signal.org',
        ],
        ['https://signal.org/abc', 'hi\nhttps://signal.org/abc'],
        ['https://signal.org/abc', 'hi\r\n\thttps://signal.org/abc'],
        ['https://signal.org/abcd', 'https://signal.org/abc\u200b'],
        ['https://signal.org', ''],
      ]) {
        assert.isFalse(
          isPreviewOfHiddenCharacterLink(url ?? '', body),
          JSON.stringify([url, body])
        );
      }
    });
  });

  describe('#isValidLinkPreviewForBody (Tellomi, PM 2026-10-19)', () => {
    const valid = (body: string, url: string) =>
      isValidLinkPreviewForBody(body, { url, title: 'T' }, { isStory: false });

    it('drops a preview for a link with a hidden character', () => {
      assert.isFalse(
        valid('https://sig\u200bnal.org/abc', 'https://sig\u200bnal.org/abc')
      );
      assert.isFalse(
        valid('https://signal.org/abc\ufeff', 'https://signal.org/abc')
      );
      assert.isFalse(
        valid('https://signal.org/abc\u200b', 'https://signal.org/abc\u200b')
      );
    });

    it('keeps a preview for a link that ended before the hidden character', () => {
      assert.isTrue(
        valid('https://signal.org/abc,\u200f next', 'https://signal.org/abc')
      );
      assert.isTrue(
        valid(
          'https://zh.wikipedia.org/wiki/中国，\u200b很好',
          'https://zh.wikipedia.org/wiki/中国'
        )
      );
    });

    it('is Signal’s check otherwise', () => {
      assert.isTrue(
        valid('see https://signal.org today', 'https://signal.org')
      );
      assert.isFalse(valid('no link', 'https://signal.org'));
      assert.isFalse(valid('http://signal.org', 'http://signal.org'));
    });
  });

  describe('#shouldLinkifyMessage;', () => {
    it('returns false for strings with directional override characters', () => {
      assert.isFalse(shouldLinkifyMessage('\u202c'));
      assert.isFalse(shouldLinkifyMessage('\u202d'));
      assert.isFalse(shouldLinkifyMessage('\u202e'));
    });

    it('returns true other strings', () => {
      assert.isTrue(shouldLinkifyMessage(null));
      assert.isTrue(shouldLinkifyMessage(undefined));
      assert.isTrue(shouldLinkifyMessage('Random other string aqu%C3%AD'));
    });
  });

  describe('#findLinks', () => {
    it('returns all links if no caretLocation is provided', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';

      const expected = [
        'https://github.com/signalapp/Signal-Desktop',
        'https://github.com/signalapp/Signal-Android',
      ];

      const actual = findLinks(text);
      assert.deepEqual(expected, actual);
    });

    it('returns all links after emojis without spaces in between', () => {
      const text = '😎https://github.com/signalapp/Signal-Desktop😛';

      const expected = ['https://github.com/signalapp/Signal-Desktop'];

      const actual = findLinks(text);
      assert.deepEqual(expected, actual);
    });

    it('returns all links after emojis with spaces in between, if a caretLocation is provided', () => {
      const text = '😎 https://github.com/signalapp/Signal-Desktop';

      const expected = ['https://github.com/signalapp/Signal-Desktop'];

      const actual = findLinks(text, 46);
      assert.deepEqual(expected, actual);
    });

    it('returns all links after a complex emoji, if a caretLocation is provided', () => {
      const text = '👨‍👩‍👦 https://github.com/signalapp/Signal-Desktop';

      const expected = ['https://github.com/signalapp/Signal-Desktop'];

      const actual = findLinks(text, 52);
      assert.deepEqual(expected, actual);
    });

    it('includes all links if cursor is not in a link', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';
      const caretLocation = 10;

      const expected = [
        'https://github.com/signalapp/Signal-Desktop',
        'https://github.com/signalapp/Signal-Android',
      ];

      const actual = findLinks(text, caretLocation);
      assert.deepEqual(expected, actual);
    });

    it('excludes a link not at the end if the caret is inside of it', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';
      const caretLocation = 30;

      const expected = ['https://github.com/signalapp/Signal-Android'];

      const actual = findLinks(text, caretLocation);
      assert.deepEqual(expected, actual);
    });

    it('excludes a link not at the end if the caret is at its end', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';
      const caretLocation = 64;

      const expected = ['https://github.com/signalapp/Signal-Android'];

      const actual = findLinks(text, caretLocation);
      assert.deepEqual(expected, actual);
    });

    it('excludes a link at the end of the caret is inside of it', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';
      const caretLocation = 100;

      const expected = ['https://github.com/signalapp/Signal-Desktop'];

      const actual = findLinks(text, caretLocation);
      assert.deepEqual(expected, actual);
    });

    it('includes link at the end if cursor is at its end', () => {
      const text =
        'Check out this link: https://github.com/signalapp/Signal-Desktop\nAnd this one too: https://github.com/signalapp/Signal-Android';
      const caretLocation = text.length;

      const expected = [
        'https://github.com/signalapp/Signal-Desktop',
        'https://github.com/signalapp/Signal-Android',
      ];

      const actual = findLinks(text, caretLocation);
      assert.deepEqual(expected, actual);
    });
  });

  describe('#isLinkSneaky', () => {
    it('returns "yes" for =', () => {
      const link = 'r.id=s.id';
      assert.strictEqual(isLinkSneaky(link), 'yes');
    });

    it('returns "yes" for strings with unicode drawing characters', () => {
      assert.strictEqual(
        isLinkSneaky('https://example.com/\u2500/stuff'),
        'yes'
      );
      assert.strictEqual(
        isLinkSneaky('https://example.com/\u2588/stuff'),
        'yes'
      );
      assert.strictEqual(
        isLinkSneaky('https://example.com/\u25FF/stuff'),
        'yes'
      );
    });

    it('returns "yes" for $', () => {
      const link = 'r.id$s.id';
      assert.strictEqual(isLinkSneaky(link), 'yes');
    });

    it('returns "yes" for +', () => {
      const link = 'r.id+s.id';
      assert.strictEqual(isLinkSneaky(link), 'yes');
    });

    it('returns "yes" for ^', () => {
      const link = 'r.id^s.id';
      assert.strictEqual(isLinkSneaky(link), 'yes');
    });

    it('returns "yes" for URLs with a length of 4097 or higher', () => {
      const href = `https://example.com/${'a'.repeat(4077)}`;
      assert.lengthOf(href, 4097, 'Test href is not the proper length');

      assert.strictEqual(isLinkSneaky(href), 'yes');
      assert.strictEqual(isLinkSneaky(`${href}?foo=bar`), 'yes');
    });

    describe('auth', () => {
      it('returns "yes" for hrefs with auth (or pretend auth)', () => {
        assert.strictEqual(
          isLinkSneaky('https://user:pass@example.com'),
          'yes'
        );
        assert.strictEqual(isLinkSneaky('https://user:@example.com'), 'yes');
        assert.strictEqual(isLinkSneaky('https://:pass@example.com'), 'yes');
        assert.strictEqual(
          isLinkSneaky('http://whatever.com&login=someuser@77777777'),
          'yes'
        );
      });
    });

    describe('domain', () => {
      it('returns false for all-latin domain', () => {
        const link = 'https://www.amazon.com';
        const actual = isLinkSneaky(link);
        assert.strictEqual(actual, false);
      });

      it('returns false for IPv4 addresses', () => {
        assert.isFalse(isLinkSneaky('https://127.0.0.1/path'));
      });

      // It's possible that this should return `false` but we'd need to add special logic
      //   for it.
      it('returns "yes" for IPv6 addresses', () => {
        assert.strictEqual(
          isLinkSneaky(
            'https://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]/path'
          ),
          'yes'
        );
        assert.strictEqual(isLinkSneaky('https://[::]/path'), 'yes');
      });

      it('returns "yes" for Latin + Cyrillic domain', () => {
        const link = 'https://www.aмazon.com';
        const actual = isLinkSneaky(link);
        assert.strictEqual(actual, 'yes');
      });

      it('returns "yes" for Latin + Greek domain', () => {
        const link = 'https://www.αpple.com';
        const actual = isLinkSneaky(link);
        assert.strictEqual(actual, 'yes');
      });

      it('returns "yes" for ASCII and non-ASCII mix', () => {
        const link = 'https://www.аррӏе.com';
        const actual = isLinkSneaky(link);
        assert.strictEqual(actual, 'yes');
      });

      it('returns "yes" for Latin + High Greek domain', () => {
        const link = `https://www.apple${String.fromCodePoint(0x101a0)}.com`;
        const actual = isLinkSneaky(link);
        assert.strictEqual(actual, 'yes');
      });

      it("returns 'yes' if the domain doesn't contain a .", () => {
        assert.strictEqual(isLinkSneaky('https://example'), 'yes');
        assert.strictEqual(isLinkSneaky('https://localhost'), 'yes');
        assert.strictEqual(isLinkSneaky('https://localhost:3000'), 'yes');
      });

      it('returns "yes" if the domain has any empty labels', () => {
        assert.strictEqual(isLinkSneaky('https://example.'), 'yes');
        assert.strictEqual(isLinkSneaky('https://example.com.'), 'yes');
        assert.strictEqual(isLinkSneaky('https://.example.com'), 'yes');
        assert.strictEqual(isLinkSneaky('https://..example.com'), 'yes');
      });

      it('returns "yes" if the domain is longer than 2048 UTF-16 code points', () => {
        const domain = `${'a'.repeat(2041)}.example`;
        assert.lengthOf(domain, 2049, 'Test domain is the incorrect length');
        const link = `https://${domain}/foo/bar`;
        assert.strictEqual(isLinkSneaky(link), 'yes');
      });
    });

    describe('pathname', () => {
      it('returns false for no pathname', () => {
        assert.isFalse(isLinkSneaky('https://example.com'));
        assert.isFalse(isLinkSneaky('https://example.com/'));
      });

      it('returns false if the pathname contains valid characters', () => {
        assert.isFalse(isLinkSneaky('https://example.com/foo'));
        assert.isFalse(isLinkSneaky('https://example.com/foo/bar'));
        assert.isFalse(
          isLinkSneaky("https://example.com/:/[]@!$&'()*+,;=abc123-._~%")
        );
        assert.isFalse(
          isLinkSneaky(
            'https://lbry.tv/@ScammerRevolts:b0/DELETING-EVERY-FILE-OFF-A-SCAMMERS-LAPTOP-Destroyed:1'
          )
        );
      });

      it('returns "maybe" if the pathname contains invalid characters', () => {
        assert.strictEqual(
          isLinkSneaky('https://example.com/hello world'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/aquí-está'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/hello\x00world'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/hello\nworld'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/hello😈world'),
          'maybe'
        );
      });
    });

    describe('query string', () => {
      it('returns false for no query', () => {
        assert.isFalse(isLinkSneaky('https://example.com/foo'));
        assert.isFalse(isLinkSneaky('https://example.com/foo?'));
      });

      it('returns false if the query string contains valid characters', () => {
        assert.isFalse(isLinkSneaky('https://example.com/foo?bar'));
        assert.isFalse(isLinkSneaky('https://example.com/foo?bar=baz'));
        assert.isFalse(
          isLinkSneaky(
            "https://example.com/foo?bar=:/[]@!$&'()*+,;=abc123-._~%"
          )
        );
        assert.isFalse(
          isLinkSneaky(
            "https://example.com/foo?:/[]@!$&'()*+,;=abc123-._~%=baz"
          )
        );
      });

      it('returns "maybe" if the query string contains invalid characters', () => {
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?bar baz'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?bar baz=qux'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?bar=baz qux'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?aquí=está'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?hello=\x00world'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?hello=hello\nworld'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo?hello=😈world'),
          'maybe'
        );
      });
    });

    describe('hash', () => {
      it('returns false for no hash', () => {
        assert.isFalse(isLinkSneaky('https://example.com/foo'));
        assert.isFalse(isLinkSneaky('https://example.com/foo#'));
      });

      it('returns false if the hash contains valid characters', () => {
        assert.isFalse(isLinkSneaky('https://example.com/foo#bar'));
        assert.isFalse(
          isLinkSneaky("https://example.com/foo#:/[]@!$&'()*+,;=abc123-._~%")
        );
      });

      it('returns "maybe" if the hash contains invalid characters', () => {
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#bar baz'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#bar baz=qux'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#bar=baz qux'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#aquí_está'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#hello\x00world'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#hello\nworld'),
          'maybe'
        );
        assert.strictEqual(
          isLinkSneaky('https://example.com/foo#hello😈world'),
          'maybe'
        );
      });
    });
  });
});
