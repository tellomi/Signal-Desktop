// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import * as MIME from '../types/MIME.std.ts';

// Tellomi (spec attachment-files-location L-11): a location message, recognised from today's format. There is no
// structured location field yet: every Signal client sends a map image and a body whose last line is
// `https://maps.google.com/maps?q=<lat>,<lng>` (the comma often `%2C`) — Signal-iOS: address lines, a blank line,
// the link; Signal-Android: [name][address] + the link; Tellomi: name + one-line address + the link. Same rules as
// iOS / Android `TellomiLocationMessage`. The phones show "📍 Location" for it in the chat list, notifications and
// quotes (Signal-iOS#296, Signal-Android#366; Telegram does the same on both).

// Upstream iOS addresses run to five or six lines; more than this is someone's own text, left as it is.
const MAX_TEXT_LINES = 6;
const MAX_LINE_LENGTH = 300;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export type TellomiCoordinate = Readonly<{
  latitude: number;
  longitude: number;
}>;

// The coordinates in `https://maps.google.com/maps?q=<lat>,<lng>`. The whole line has to be the link.
export function tellomiCoordinateFromMapsLink(
  line: string
): TellomiCoordinate | undefined {
  if (/\s/.test(line)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(line);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== 'maps.google.com') {
    return undefined;
  }
  if (!['', '/', '/maps'].includes(url.pathname)) {
    return undefined;
  }
  const query = url.searchParams.get('q');
  if (query == null) {
    return undefined;
  }
  const parts = query.split(',').map(part => part.trim());
  if (parts.length !== 2 || !parts.every(part => DECIMAL.test(part))) {
    return undefined;
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }
  return { latitude, longitude };
}

// The text reads as a location: the maps link last, at most six short lines above it.
export function isTellomiLocationBody(body: string | undefined): boolean {
  if (!body) {
    return false;
  }
  const lines = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const link = lines.pop();
  if (link == null || tellomiCoordinateFromMapsLink(link) == null) {
    return false;
  }
  const textLines = lines.filter(line => line !== '');
  return (
    textLines.length <= MAX_TEXT_LINES &&
    textLines.every(line => line.length <= MAX_LINE_LENGTH)
  );
}

type AttachmentLike = Readonly<{
  contentType?: string;
  tellomiLivePhotoVideo?: unknown;
}>;

// A still image: not a GIF, not a video, not a live photo.
function isStillImage(attachment: AttachmentLike | undefined): boolean {
  const contentType = attachment?.contentType;
  return (
    contentType != null &&
    MIME.isImage(contentType) &&
    !MIME.isGif(contentType) &&
    attachment?.tellomiLivePhotoVideo == null
  );
}

// A message that is a location: exactly one still image and a location body.
export function isTellomiLocationMessage(
  body: string | undefined,
  attachments: ReadonlyArray<AttachmentLike> | undefined
): boolean {
  return (
    attachments?.length === 1 &&
    isStillImage(attachments[0]) &&
    isTellomiLocationBody(body)
  );
}

// A quote of a location: its text is a location body and its attachment a still image.
export function isTellomiQuotedLocation(
  text: string | undefined,
  attachment: AttachmentLike | undefined
): boolean {
  return isStillImage(attachment) && isTellomiLocationBody(text);
}
