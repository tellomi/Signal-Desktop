// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';

import {
  BUNDLED_LINK_ICONS_DIR,
  BUNDLED_LINK_REGISTRY,
} from '../../linkPreviews/bundledLinkRegistry.std.ts';
import { readBundledLinkIcon } from '../../linkPreviews/linkCardIcon.node.ts';
import {
  isLinkIconFileName,
  readPngSize,
} from '../../linkPreviews/linkCardIcon.std.ts';

// ADR-0063 §九.6 / card-visual §3.7: a brand shell's icon is read from the files that ship with
// the app, by the name rust/links puts in the card. The name comes out of a registry that can be
// hot-updated, so it is checked before any file is touched.

const BUNDLED_DIR = join(cwd(), 'build', 'links');
const ICONS_DIR = join(BUNDLED_DIR, BUNDLED_LINK_ICONS_DIR);

function ihdr(width: number, height: number): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('isLinkIconFileName', () => {
  it('takes a lowercase .png name', () => {
    for (const name of ['taobao.png', 'weixin-mp.png', 'a.png', 'x1-2y.png']) {
      assert.isTrue(isLinkIconFileName(name), name);
    }
  });

  it('refuses anything that could leave the icons directory or is not an icon name', () => {
    for (const name of [
      '',
      '.png',
      'png',
      '../x.png',
      '..\\x.png',
      'a/b.png',
      'a\\b.png',
      '/etc/passwd.png',
      './x.png',
      'x.png/',
      '..',
      'Taobao.png',
      'taobao.PNG',
      'TAOBAO.png',
      'taobao.jpg',
      'taobao.png.exe',
      'taobao.png\n',
      'taobao.png\0',
      ' taobao.png',
      'tao bao.png',
      'tao_bao.png',
      '淘宝.png',
      '%2e%2e.png',
    ]) {
      assert.isFalse(isLinkIconFileName(name), JSON.stringify(name));
    }
  });

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 5, {}, ['taobao.png']]) {
      assert.isFalse(isLinkIconFileName(value));
    }
  });
});

describe('readPngSize', () => {
  it('reads the size of the icons that ship', () => {
    const bytes = readFileSync(join(ICONS_DIR, 'taobao.png'));
    assert.deepEqual(readPngSize(bytes), { width: 114, height: 114 });
  });

  it('reads width and height as big-endian numbers, from a view into a bigger buffer', () => {
    const inner = ihdr(300, 200);
    const padded = Buffer.concat([Buffer.from([1, 2, 3]), inner]);
    assert.deepEqual(readPngSize(padded.subarray(3)), {
      width: 300,
      height: 200,
    });
  });

  it('is undefined for anything that is not a PNG header', () => {
    assert.isUndefined(readPngSize(new Uint8Array()));
    assert.isUndefined(readPngSize(ihdr(10, 10).subarray(0, 23)));
    const wrongSignature = ihdr(10, 10);
    wrongSignature[1] = 0x51;
    assert.isUndefined(readPngSize(wrongSignature));
    const wrongLength = ihdr(10, 10);
    wrongLength.writeUInt32BE(12, 8);
    assert.isUndefined(readPngSize(wrongLength));
    const wrongChunk = ihdr(10, 10);
    wrongChunk.write('IDAT', 12, 'ascii');
    assert.isUndefined(readPngSize(wrongChunk));
    assert.isUndefined(readPngSize(Buffer.from('<svg xmlns="x"></svg> ....')));
  });

  it('is undefined for a size no bundled icon has', () => {
    assert.isUndefined(readPngSize(ihdr(0, 100)));
    assert.isUndefined(readPngSize(ihdr(100, 0)));
    assert.isUndefined(readPngSize(ihdr(1025, 100)));
    assert.isUndefined(readPngSize(ihdr(100, 0xffffffff)));
  });
});

describe('readBundledLinkIcon', () => {
  let dir: string;
  let iconsDir: string;
  const png = readFileSync(join(ICONS_DIR, 'taobao.png'));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'link-icons-'));
    iconsDir = join(dir, 'icons');
    mkdirSync(iconsDir);
    writeFileSync(join(iconsDir, 'taobao.png'), png);
  });

  it('gives the icon as a data: URL, with the size layout() needs', () => {
    const icon = readBundledLinkIcon(iconsDir, 'taobao.png');
    assert.isDefined(icon);
    assert.strictEqual(icon?.width, 114);
    assert.strictEqual(icon?.height, 114);
    assert.match(icon?.url ?? '', /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    assert.isTrue(
      Buffer.from(
        (icon?.url ?? '').slice('data:image/png;base64,'.length),
        'base64'
      ).equals(png),
      'the URL carries exactly the bytes of the file'
    );
  });

  it('cannot be pointed out of the icons directory', () => {
    // A perfectly good icon, one level up, and in a sub directory.
    writeFileSync(join(dir, 'secret.png'), png);
    mkdirSync(join(iconsDir, 'sub'));
    writeFileSync(join(iconsDir, 'sub', 'b.png'), png);

    for (const name of [
      '../secret.png',
      '..//secret.png',
      'sub/b.png',
      'sub\\b.png',
      join(dir, 'secret.png'),
      '....//secret.png',
    ]) {
      assert.isUndefined(readBundledLinkIcon(iconsDir, name), name);
    }
    // ... and the good ones are good, so the refusals above are about the names.
    assert.isDefined(readBundledLinkIcon(join(iconsDir, 'sub'), 'b.png'));
    assert.isDefined(readBundledLinkIcon(dir, 'secret.png'));
  });

  it('is no icon for a name that is not an icon file name', () => {
    writeFileSync(join(iconsDir, 'Taobao.png'), png);
    writeFileSync(join(iconsDir, 'taobao.jpg'), png);
    for (const name of ['', 'Taobao.png', 'taobao.jpg', undefined, null, 7]) {
      assert.isUndefined(readBundledLinkIcon(iconsDir, name), String(name));
    }
  });

  it('is no icon for a file that is not there (a brand pulled in by a hot update)', () => {
    assert.isUndefined(readBundledLinkIcon(iconsDir, 'newbrand.png'));
    assert.isUndefined(readBundledLinkIcon(join(dir, 'nowhere'), 'taobao.png'));
  });

  it('is no icon for something that is not a PNG file we shipped', () => {
    writeFileSync(
      join(iconsDir, 'text.png'),
      'not a picture at all, just text'
    );
    writeFileSync(join(iconsDir, 'tiny.png'), png.subarray(0, 20));
    writeFileSync(join(iconsDir, 'huge.png'), Buffer.alloc(300 * 1024, 7));
    mkdirSync(join(iconsDir, 'folder.png'));
    symlinkSync(join(iconsDir, 'taobao.png'), join(iconsDir, 'link.png'));

    for (const name of [
      'text.png',
      'tiny.png',
      'huge.png',
      'folder.png',
      'link.png',
    ]) {
      assert.isUndefined(readBundledLinkIcon(iconsDir, name), name);
    }
  });
});

describe('the icons that ship (build/links/icons)', () => {
  const envelope = JSON.parse(
    readFileSync(join(BUNDLED_DIR, BUNDLED_LINK_REGISTRY), 'utf8')
  ) as { payload: { providers: ReadonlyArray<{ icon?: string }> } };
  const named = envelope.payload.providers
    .map(provider => provider.icon)
    .filter((icon): icon is string => icon != null);

  it('has every icon the bundled registry names, and only those', () => {
    assert.isAtLeast(named.length, 7);
    assert.sameMembers(
      readdirSync(ICONS_DIR).filter(name => !name.startsWith('.')),
      named
    );
  });

  it('reads them all: a PNG, square, at least 108 px', () => {
    for (const name of named) {
      assert.isTrue(isLinkIconFileName(name), name);
      const icon = readBundledLinkIcon(ICONS_DIR, name);
      assert.isDefined(icon, name);
      assert.strictEqual(icon?.width, icon?.height, `${name} is square`);
      assert.isAtLeast(icon?.width ?? 0, 108, `${name} is at least 108 px`);
    }
  });
});
