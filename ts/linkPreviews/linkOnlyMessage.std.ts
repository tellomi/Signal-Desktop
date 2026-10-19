// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { findLinks, getLinkifiableLength } from '../types/LinkPreview.std.ts';
import { maybeParseUrl } from '../util/url.std.ts';
import type { LinkCardType } from './linkCard.std.ts';

// card-visual §3.5 (2026-09-29): a message that is nothing but one link shows the card alone, with
// no link text under it; the URL stays in the card's tooltip and in "Copy". With no preview at all
// (previews off, or fetching failed), or when rust/links decided "plain link", the receiver draws
// a no-image card from the URL alone: the registrable domain and a link icon (§3.7, first row).
// A message with anything else keeps Signal's layout.

const LINK_ONLY = /^https?:\/\/\S+$/i;

// White space String#trim removes, minus U+FEFF. FEFF is also `\s` / trimmed in JavaScript,
// but it is IRI_HIDDEN (a character a reader cannot see), not ordinary surrounding white space.
// A body that is a URL plus a trailing FEFF must not become a link-only card (PM 2026-10-19,
// ADR-0063 §5.6; same as the receiver Linkify filter).
const ORDINARY_TRIM_WS =
  /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;

function trimOrdinaryWhiteSpace(text: string): string {
  return text.replace(ORDINARY_TRIM_WS, '');
}

// The link the whole body consists of, or undefined. `hasOtherContent`: anything that makes the
// message more than plain text (formatting, spoilers, mentions, attachments, long text, a sticker,
// a contact…).
export function getLinkOnlyUrl(
  body: string | undefined,
  hasOtherContent: boolean
): string | undefined {
  if (hasOtherContent || !body) {
    return undefined;
  }
  // Do not use String#trim: it strips U+FEFF, which would hide a trailing hidden character.
  const trimmed = trimOrdinaryWhiteSpace(body);
  // Most messages are not a link: rule them out without parsing.
  if (!LINK_ONLY.test(trimmed)) {
    return undefined;
  }
  const url = maybeParseUrl(trimmed);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return undefined;
  }
  // The body must show it as one link, all of it: nothing linkify leaves out (trailing
  // punctuation, text after a space) and no text Signal refuses to linkify.
  // Tellomi (PM 2026-10-19, ADR-0063 §5.6): nor a link with a hidden character in it, which is not
  // clickable and gets no card, not even the one drawn from the URL alone.
  const links = findLinks(trimmed);
  return links.length === 1 &&
    links[0] === trimmed &&
    getLinkifiableLength(trimmed) === trimmed.length
    ? trimmed
    : undefined;
}

// Whether the bubble is the card alone: the body is exactly the link of its only preview, and
// rust/links decided what that card is (without a decision, Signal's layout stays).
export function isLinkCardOnly(
  linkOnlyUrl: string | undefined,
  previews: ReadonlyArray<Readonly<{ url: string; card?: LinkCardType }>>
): boolean {
  if (linkOnlyUrl === undefined || previews.length !== 1) {
    return false;
  }
  const [preview] = previews;
  return preview?.url === linkOnlyUrl && preview.card !== undefined;
}

// The no-image card drawn from the URL alone: the domain rust/links computed and whether it
// imitates a well-known one (§6.1); nothing the sender wrote, nothing a first-party card adds.
export function toPlainLinkCard(
  card: LinkCardType,
  lookalike?: string
): LinkCardType {
  return {
    ...card,
    level: 'plain_link',
    provider: null,
    provider_name: null,
    kind: null,
    route: null,
    title: null,
    description: null,
    attrs: [],
    official_badge: false,
    first_party: null,
    lookalike: card.lookalike ?? lookalike ?? null,
    show_image: false,
    tintable: false,
  };
}
