// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { AttachmentForUIType } from '../../types/Attachment.std.ts';
import { getThumbnailUrl } from '../../util/Attachment.std.ts';
import { ImageOrBlurhash } from '../ImageOrBlurhash.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';

export type PropsType = Readonly<{
  attachment: AttachmentForUIType;
}>;

/**
 * Tellomi (ADR-0068, spec R-3): a photo / video sent as a file is still a file row, with its thumbnail
 * where the generic file icon goes (same footprint, so the row keeps its height). Shown once the file is
 * here; until then `AttachmentStatusIcon` shows the download control in its place, as for any file.
 */
export function TellomiAsFileThumbnail({ attachment }: PropsType): JSX.Element {
  return (
    <div className={tw('mx-0.75 size-10 shrink-0 overflow-hidden rounded-lg')}>
      <ImageOrBlurhash
        src={getThumbnailUrl(attachment)}
        blurHash={attachment.blurHash}
        alt=""
        fallbackToBlurhashOnError
        className={tw('object-cover')}
      />
    </div>
  );
}
