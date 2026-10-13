// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { AttachmentType } from '../types/Attachment.std.ts';
import { downloadAttachment } from '../util/downloadAttachment.preload.ts';
import { getLocalAttachmentUrl } from '../util/getLocalAttachmentUrl.std.ts';
import { createLogger } from '../logging/log.std.ts';
import * as Errors from '../types/errors.std.ts';

const log = createLogger('TellomiLivePhoto');

/** The moving half is a few seconds of video; anything far bigger isn't downloaded. */
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

const downloaded = new Map<string, string>();
const inFlight = new Map<string, Promise<string | undefined>>();

/**
 * Tellomi (tellomi/tellomi#1263, spec R-2): the moving half of a live photo, as a URL a <video> can
 * play. It isn't an attachment of its own: the first time it plays it is downloaded into the
 * (encrypted) attachments folder and kept for this run; orphan cleanup removes the file on a later
 * start. Undefined when it can't be had (the still shows as an ordinary picture).
 */
export async function fetchTellomiLivePhotoVideo(
  attachment: Pick<AttachmentType, 'tellomiLivePhotoVideo'>
): Promise<string | undefined> {
  const video = attachment.tellomiLivePhotoVideo;
  if (
    video?.cdnKey == null ||
    video.size == null ||
    video.size <= 0 ||
    video.size > MAX_VIDEO_BYTES
  ) {
    return undefined;
  }
  const key = video.cdnKey;
  const cached = downloaded.get(key);
  if (cached != null) {
    return cached;
  }
  const pending = inFlight.get(key);
  if (pending != null) {
    return pending;
  }

  const download = (async () => {
    try {
      const result = await downloadAttachment({
        attachment: video,
        options: {
          onSizeUpdate: () => undefined,
          abortSignal: new AbortController().signal,
          hasMediaBackups: false,
          logId: `TellomiLivePhoto(${key.slice(0, 8)})`,
          messageExpiresAt: null,
        },
      });
      const url = getLocalAttachmentUrl({
        ...video,
        ...result,
      });
      downloaded.set(key, url);
      return url;
    } catch (error) {
      log.warn(
        "couldn't download a live photo video",
        Errors.toLogFormat(error)
      );
      return undefined;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, download);
  return download;
}
