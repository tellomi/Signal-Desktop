// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '../logging/log.std.ts';
import type { LinkCardIconType } from './linkCardIcon.std.ts';
import { isLinkIconFileName, readPngSize } from './linkCardIcon.std.ts';
import { getLinkErrorKind } from './linkLog.std.ts';

const log = createLogger('linkCardIcon');

// The icons are 2–16 KB; a file far bigger is not one of ours.
const MAX_LINK_ICON_BYTES = 256 * 1024;

// ADR-0063 §九.6: a brand shell's icon is read from the icons that ship with the app
// (build/links/icons), never from the network. The registry may name a file that is not there (a
// brand pulled in by a hot update whose icon has not shipped yet): that is "no icon", not an error.
// Nothing here throws, so the card can always be drawn without it.
//
// `fileName` comes from a card, which comes from a registry, which can be hot-updated: it is
// checked against the icon name shape before the file system is touched, so it can neither leave
// `iconsDir` (`../x.png`, `a/b.png`) nor name anything that is not a lowercase `.png`.
export function readBundledLinkIcon(
  iconsDir: string,
  fileName: unknown
): LinkCardIconType | undefined {
  if (!isLinkIconFileName(fileName)) {
    return undefined;
  }

  try {
    const path = join(iconsDir, fileName);
    // `lstat`: a link is not a file we shipped.
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_LINK_ICON_BYTES) {
      return undefined;
    }
    const bytes = readFileSync(path);
    const size = readPngSize(bytes);
    if (!size) {
      log.warn('a bundled brand icon is not a PNG');
      return undefined;
    }
    return {
      url: `data:image/png;base64,${bytes.toString('base64')}`,
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    // Only the kind of failure: the name of a missing icon says which brand the registry names.
    log.debug(`brand icon not read: ${getLinkErrorKind(error)}`);
    return undefined;
  }
}
