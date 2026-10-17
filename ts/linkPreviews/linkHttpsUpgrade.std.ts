// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { shouldPreviewHref } from '../types/LinkPreview.std.ts';
import { maybeParseUrl } from '../util/url.std.ts';

// owner 2026-10-17 (ADR-0063 §5.6): a link written as `http://b23.tv/abc` or `b23.tv/abc` gets a
// card over https when the link registry claims the https link (a brand or a short link,
// `claimsHttpsUpgrade` in linkRegistry.preload.ts); first-party hosts do not count (the official
// badge and user cards need https in the body, §4.8), and anything the registry does not claim
// stays a plain link, as Signal has it. Only https is ever fetched.
//
// Same rules as iOS `LinkValidator.tellomiHttpsUpgrade` / `TellomiLinkClassifier.body(_:upgradingLinkTo:claims:)`
// and Android `TellomiLinkHttpsUpgrade`.

const HTTP = 'http://';
const HTTPS = 'https://';

// As rust/links `url_appears_in_body`: what may not come right before a link.
const LINK_PUNCTUATION = '-._~:/?#@$&*+=%';

function hasPrefixIgnoringCase(text: string, prefix: string): boolean {
  return text.slice(0, prefix.length).toLowerCase() === prefix;
}

// Send side: the https link to preview for `link` (a link as `findLinks` returns it: `http://…`
// as written, or without a scheme), or undefined. The https spelling must pass Signal's own rules
// (`shouldPreviewHref`, no user name or password) and be claimed.
export function getHttpsUpgrade(
  link: string,
  claims: (httpsUrl: string) => boolean
): string | undefined {
  let rest: string;
  if (hasPrefixIgnoringCase(link, HTTP)) {
    rest = link.slice(HTTP.length);
  } else if (link.includes('://')) {
    return undefined;
  } else {
    rest = link;
  }
  if (!rest) {
    return undefined;
  }
  const https = HTTPS + rest;
  const url = maybeParseUrl(https);
  // A user name is an email address (`me@b23.tv`) or a disguise, never a page.
  if (!url || url.username || url.password || !shouldPreviewHref(https)) {
    return undefined;
  }
  return claims(https) ? https : undefined;
}

function isPartOfLink(char: string): boolean {
  return /^[A-Za-z0-9]$/.test(char) || LINK_PUNCTUATION.includes(char);
}

// Receive side: the body to give rust/links for a preview of `previewUrl`. Where the body writes
// this link as `http://…` or without a scheme and the registry claims its https form, each such
// occurrence is spelt https, so rust/links finds the link in the body (whether an occurrence
// really ends there is still for rust/links to say). Only this copy changes; the message body
// shown is untouched. Anything else comes back as it was.
export function getBodyWithHttpsLink(
  body: string,
  previewUrl: string,
  claims: (httpsUrl: string) => boolean
): string {
  if (!hasPrefixIgnoringCase(previewUrl, HTTPS) || body.includes(previewUrl)) {
    return body;
  }
  // As rust/links: one trailing '/' of the preview URL may be missing in the body.
  let needle = previewUrl.slice(HTTPS.length);
  const withoutSlash = needle.slice(0, -1);
  if (
    needle.endsWith('/') &&
    !withoutSlash.endsWith('/') &&
    !withoutSlash.endsWith(':')
  ) {
    needle = withoutSlash;
  }
  if (!needle) {
    return body;
  }

  const replaced: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const at = body.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    const end = at + needle.length;
    from = end;
    const before = body.slice(0, at);
    const last = before.at(-1);
    if (before.slice(-HTTP.length).toLowerCase() === HTTP) {
      replaced.push({ start: at - HTTP.length, end });
    } else if (last != null && isPartOfLink(last)) {
      // Part of a longer link (`evil-b23.tv`, `https://x/b23.tv`) or an email address.
      continue;
    } else {
      replaced.push({ start: at, end });
    }
  }
  if (replaced.length === 0 || !claims(previewUrl)) {
    return body;
  }

  let result = body;
  for (const { start, end } of replaced.reverse()) {
    result = result.slice(0, start) + HTTPS + needle + result.slice(end);
  }
  return result;
}
