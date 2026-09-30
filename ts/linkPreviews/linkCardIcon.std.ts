// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0063 §5.1 / §九.6, card-visual §3.7 / §3.9: a brand shell shows the icon that ships with the
// app, never a picture the sender sent. rust/links names the file in the card (`icon`); this is the
// part that needs no file system: which names are acceptable and how big a PNG is.

// The shape of a bundled icon's file name (rust/links `provider.icon`, links/icons/*.png). Checked
// before any file system access, so a name can never leave the icons directory.
const LINK_ICON_FILE_NAME = /^[a-z0-9-]+\.png$/;

// The icons are 114–200 px; nothing this large is one of ours.
const MAX_LINK_ICON_PIXELS = 1024;

export function isLinkIconFileName(value: unknown): value is string {
  return typeof value === 'string' && LINK_ICON_FILE_NAME.test(value);
}

// A bundled icon, ready for the card: a `data:` URL (the renderer may not load anything else, and
// the bytes are read from the app's own files), and the pixel size `layout()` decides the shape by.
export type LinkCardIconType = Readonly<{
  url: string;
  width: number;
  height: number;
}>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];

// The pixel size from a PNG's header: the 8-byte signature, then the first chunk, which must be
// IHDR (length 13), starting with width and height as big-endian 32-bit numbers.
export function readPngSize(
  bytes: Uint8Array<ArrayBuffer>
): Readonly<{ width: number; height: number }> | undefined {
  if (bytes.length < 24) {
    return undefined;
  }
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) {
    return undefined;
  }
  if (IHDR.some((byte, index) => bytes[12 + index] !== byte)) {
    return undefined;
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_LINK_ICON_PIXELS ||
    height > MAX_LINK_ICON_PIXELS
  ) {
    return undefined;
  }
  return { width, height };
}
