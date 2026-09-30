// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// The picture types a link preview takes (ADR-0063 §4.4: "images keep each platform's values"):
// what the send job lets the fetcher bring back, and what the image check then accepts, are one
// list, so a picture is never fetched, counted against the "+1 image request", and then thrown
// away because the two disagreed.
//
// ICO has two names: `image/x-icon`, which most sites send and this codebase uses everywhere
// (`IMAGE_ICO`), and `image/vnd.microsoft.icon`, the one IANA registered, which a server that
// labels its favicon by the book sends. They are one format.
export const LINK_IMAGE_CONTENT_TYPES: ReadonlyArray<string> = [
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// The one name the rest of the app knows it by (`IMAGE_ICO`): a picture is never passed on under
// the other one.
export function toCanonicalLinkImageType(type: string): string {
  return type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type;
}
