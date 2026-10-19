// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import lodash from 'lodash';
// This file gets imported into renderer that does not have access to Node.js
// builtins, use an `npm` package.
// oxlint-disable-next-line unicorn/prefer-node-protocol
import nodeUrl from 'url';
import LinkifyIt from 'linkify-it';

import { maybeParseUrl } from '../util/url.std.ts';

import type { AttachmentWithHydratedData } from './Attachment.std.ts';
import {
  artAddStickersRoute,
  groupInvitesRoute,
  linkCallRoute,
} from '../util/signalRoutes.std.ts';
import type { Backups } from '../protobuf/index.std.ts';
import type { LinkPreviewType } from './message/LinkPreviews.std.ts';
import { Emoji } from '../axo/emoji.std.ts';

const { isNumber, compact, isEmpty, range } = lodash;

export type LinkPreviewImage = AttachmentWithHydratedData;

export type LinkPreviewResult = {
  title: string | null;
  url: string;
  image?: LinkPreviewImage;
  description: string | null;
  date: number | null;
  // Tellomi (ADR-0063 §4.5): `Preview.rich` bytes (base64) for this preview, if any.
  rich?: string;
};

export enum LinkPreviewSourceType {
  Composer,
  ForwardMessageModal,
  StoryCreator,
}

export type MaybeGrabLinkPreviewOptionsType = Readonly<{
  caretLocation?: number;
  conversationId?: string;
  mode?: 'conversation' | 'story';
}>;

export type AddLinkPreviewOptionsType = Readonly<{
  conversationId?: string;
  disableFetch?: boolean;
}>;

const linkify = new LinkifyIt();

export function isValidLink(maybeUrl: string | undefined): boolean {
  if (maybeUrl == null) {
    return false;
  }

  try {
    const url = new URL(maybeUrl);
    return url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

export function shouldPreviewHref(href: string): boolean {
  const url = maybeParseUrl(href);
  if (!url || url.protocol !== 'https:' || isDomainExcluded(url)) {
    return false;
  }
  const sneaky = isLinkSneaky(href);
  // Tellomi (PM 2026-10-19, ADR-0063 §5.6): a link with Chinese (or any other visible non-ASCII
  // text) in its path, query or fragment gets a preview, as Telegram's does. Signal calls such a
  // link "maybe" sneaky only because of those characters; every other check has passed by then.
  return sneaky === false || (sneaky === 'maybe' && isPreviewableIri(href));
}

// Ends a link inside its path, query or fragment: white space (Telegram's set: NBSP, U+2000-200A,
// U+2028/2029, U+202F, U+3000) and Chinese sentence punctuation, which in Chinese text follows a
// link with no space. The same table is in the iOS and Android clients.
const IRI_TERMINATOR =
  /[\s\u00a0\u2000-\u200a\u2028\u2029\u202f\u3000，。！？；：、）」』】》〉”’]/u;
// Characters a reader cannot see or that change how the text around them is shown: never part of
// a previewed link.
const IRI_HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u;
const VALID_URI_CHARACTER = /^[A-Za-z0-9%:/?#[\]@!$&'()*+,;=\-._~]$/;

// The path, query and fragment are made of URI characters and visible non-ASCII text only.
function isPreviewableIri(href: string): boolean {
  const url = maybeParseUrl(href);
  if (!url) {
    return false;
  }
  const start = href.indexOf('/', url.protocol.length + 4);
  for (const ch of start === -1 ? '' : href.slice(start)) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) {
      if (!VALID_URI_CHARACTER.test(ch)) {
        return false;
      }
    } else if (IRI_TERMINATOR.test(ch) || IRI_HIDDEN.test(ch)) {
      return false;
    }
  }
  return true;
}

// Tellomi (PM 2026-10-19, ADR-0063 §5.6): how much of a link linkify found may be shown as a
// clickable link (and previewed, see `findPreviewCandidates`). A link with a character a reader cannot see in it (`IRI_HIDDEN`, the same set
// that keeps such a link from getting a preview) is not a link at all: 0. linkify keeps Chinese
// punctuation and what follows it in the link; a hidden character after that punctuation is not
// part of the link (it already ended there, as on iOS and Android), so then only the part before
// the punctuation is clickable. Links without hidden characters are left exactly as they were.
export function getLinkifiableLength(link: string): number {
  let index = 0;
  for (const ch of link) {
    // Hidden first: U+FEFF is also `\s` in JavaScript, but it is a hidden character, not an end
    if (IRI_HIDDEN.test(ch)) {
      return 0;
    }
    if (IRI_TERMINATOR.test(ch)) {
      return IRI_HIDDEN.test(link.slice(index)) ? index : link.length;
    }
    index += ch.length;
  }
  return link.length;
}

// `https://zh.wikipedia.org/wiki/中国，很好` → `https://zh.wikipedia.org/wiki/中国`: linkify keeps
// Chinese punctuation and the text after it in the link (PM 2026-10-19, ADR-0063 §5.6).
export function cutAtIriTerminator(link: string): string {
  const url = maybeParseUrl(link);
  if (!url) {
    return link;
  }
  const start = link.indexOf('/', url.protocol.length + 4);
  if (start === -1) {
    return link;
  }
  const match = IRI_TERMINATOR.exec(link.slice(start));
  return match ? link.slice(0, start + match.index) : link;
}

export function isValidLinkPreview(
  urlsInBody: Array<string>,
  preview: LinkPreviewType | Backups.LinkPreview.Params,
  { isStory }: { isStory: boolean }
): boolean {
  const { url } = preview;
  if (!url) {
    return false;
  }

  if (!shouldPreviewHref(url)) {
    return false;
  }

  // Story link previews don't have to correspond to links in the
  // message body.
  if (!urlsInBody.includes(url) && !isStory) {
    return false;
  }

  return true;
}

const EXCLUDED_DOMAINS = [
  'debuglogs.org',
  'example',
  'example.com',
  'example.net',
  'example.org',
  'invalid',
  'localhost',
  'onion',
  'test',
];

function isDomainExcluded(url: URL): boolean {
  for (const excludedDomain of EXCLUDED_DOMAINS) {
    if (
      url.hostname.endsWith(`.${excludedDomain}`) ||
      url.hostname === excludedDomain
    ) {
      return true;
    }
  }
  return false;
}

const DIRECTIONAL_OVERRIDES = /[\u202c\u202d\u202e]/;
const UNICODE_DRAWING = /[\u2500-\u25FF]/;

export function shouldLinkifyMessage(
  message: string | null | undefined
): boolean {
  if (!message) {
    return true;
  }

  if (DIRECTIONAL_OVERRIDES.test(message)) {
    return false;
  }

  return true;
}

export function isCallLink(link = ''): boolean {
  const url = maybeParseUrl(link);
  return url?.protocol === 'https:' && linkCallRoute.isMatch(url);
}

export function isStickerPack(link = ''): boolean {
  const url = maybeParseUrl(link);
  return url?.protocol === 'https:' && artAddStickersRoute.isMatch(url);
}

export function isGroupLink(link = ''): boolean {
  const url = maybeParseUrl(link);
  return url?.protocol === 'https:' && groupInvitesRoute.isMatch(url);
}

export function findLinks(text: string, caretLocation?: number): Array<string> {
  if (!shouldLinkifyMessage(text)) {
    return [];
  }

  const haveCaretLocation = isNumber(caretLocation);
  const textWithoutEmoji = Emoji.replaceEmojiWithOneSpace(text);
  const textLength = textWithoutEmoji.length;

  const matches = linkify.match(textWithoutEmoji) ?? [];

  return compact(
    matches.map(match => {
      if (!haveCaretLocation) {
        return match.text;
      }

      if (caretLocation === undefined) {
        return null;
      }

      if (match.lastIndex === textLength && caretLocation === textLength) {
        return match.text;
      }

      if (match.index > caretLocation || match.lastIndex < caretLocation) {
        return match.text;
      }

      return null;
    })
  );
}

export function getSafeDomain(href: string): string | undefined {
  try {
    return getDomain(href);
  } catch {
    return undefined;
  }
}

export function getDomain(href: string): string {
  const url = maybeParseUrl(href);
  if (!url || !url.hostname) {
    throw new Error('getDomain: Unable to extract hostname from href');
  }

  return url.hostname;
}

// See <https://tools.ietf.org/html/rfc3986>.
const VALID_URI_CHARACTERS = new RegExp(
  '^(' +
    [
      '%',
      // "gen-delims"
      ':',
      '/',
      '?',
      '#',
      '[',
      ']',
      '@',
      // "sub-delims"
      '!',
      '$',
      '&',
      "'",
      '(',
      ')',
      '*',
      '+',
      ',',
      ';',
      '=',
      // unreserved
      // oxlint-disable-next-line typescript/no-misused-spread
      ...String.fromCharCode(...range(65, 91), ...range(97, 123)),
      ...range(10).map(String),
      '-',
      '.',
      '_',
      '~',
    ]
      .map(ch => RegExp.escape(ch))
      .join('|') +
    ')*$'
);
const ASCII_PATTERN = /[\u0020-\u007F]/g;
const MAX_HREF_LENGTH = 2 ** 12;

export function isLinkSneaky(href: string): 'yes' | 'maybe' | false {
  // This helps users avoid extremely long links (which could be hiding something
  //   sketchy) and also sidesteps the performance implications of extremely long hrefs.
  if (href.length > MAX_HREF_LENGTH) {
    return 'yes';
  }

  if (UNICODE_DRAWING.test(href)) {
    return 'yes';
  }

  const url = maybeParseUrl(href);

  // If we can't parse it, it's sneaky.
  if (!url) {
    return 'yes';
  }

  // Any links which contain auth are considered sneaky
  if (url.username || url.password) {
    return 'yes';
  }

  // If the domain is falsy, something fishy is going on
  if (!url.hostname) {
    return 'yes';
  }

  // To quote [RFC 1034][0]: "the total number of octets that represent a
  //   domain name [...] is limited to 255." To be extra careful, we set a
  //   maximum of 2048. (This also uses the string's `.length` property,
  //   which isn't exactly the same thing as the number of octets.)
  // [0]: https://tools.ietf.org/html/rfc1034
  if (url.hostname.length > 2048) {
    return 'yes';
  }

  // Domains cannot contain encoded characters
  if (url.hostname.includes('%')) {
    return 'yes';
  }

  // There must be at least 2 domain labels, and none of them can be empty.
  const labels = url.hostname.split('.');
  if (labels.length < 2 || labels.some(isEmpty)) {
    return 'yes';
  }

  // This is necessary because getDomain returns domains in punycode form.
  const unicodeDomain = nodeUrl.domainToUnicode
    ? nodeUrl.domainToUnicode(url.hostname)
    : url.hostname;

  const withoutPeriods = unicodeDomain.replace(/\./g, '');

  const hasASCII = ASCII_PATTERN.test(withoutPeriods);
  const withoutASCII = withoutPeriods.replace(ASCII_PATTERN, '');

  const isMixed = hasASCII && withoutASCII.length > 0;
  if (isMixed) {
    return 'yes';
  }

  // We can't use `url.pathname` (and so on) because it automatically encodes strings.
  //   For example, it turns `/aquí` into `/aqu%C3%AD`.
  const startOfPathAndHash = href.indexOf('/', url.protocol.length + 4);
  const pathAndHash =
    startOfPathAndHash === -1 ? '' : href.substr(startOfPathAndHash);
  if (!VALID_URI_CHARACTERS.test(pathAndHash)) {
    return 'maybe';
  }

  return false;
}
