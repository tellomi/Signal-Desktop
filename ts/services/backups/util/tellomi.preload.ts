// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import lodash from 'lodash';

import type { Backups } from '../../../protobuf/index.std.ts';
import type { AttachmentType } from '../../../types/Attachment.std.ts';
import * as Bytes from '../../../Bytes.std.ts';
import {
  isValidAttachmentKey,
  isValidDigest,
} from '../../../types/Crypto.std.ts';
import { getSafeLongFromTimestamp } from '../../../util/timestampLongUtils.std.ts';
import type { BackupImportOptions } from '../types.std.ts';
import { convertFilePointerToAttachment } from './filePointers.preload.ts';

const { omit } = lodash;

// Tellomi (tellomi/tellomi#1263, ADR-0068 §4.5): how an attachment is presented goes into a backup
// (`MessageAttachment.tellomi`) and comes back out by the rules of receiving it.

/**
 * Export: as a file, covered, and a live photo's moving half. Uncovered on this device is local
 * (spec D10) and not backed up. Null when there is nothing Tellomi.
 */
export function getTellomiAttachmentForBackup(
  attachment: AttachmentType
): Backups.TellomiAttachment.Params | null {
  const asFile = attachment.tellomiAsFile === true;
  const spoiler = attachment.tellomiSpoiler === true;
  const livePhotoVideo = attachment.tellomiLivePhotoVideo
    ? getLivePhotoVideoFilePointer(attachment.tellomiLivePhotoVideo)
    : null;
  if (!asFile && !spoiler && livePhotoVideo == null) {
    return null;
  }
  return { asFile, spoiler, livePhotoVideo };
}

/**
 * The moving half is never stored on this device, so it goes out as where it is on the transit tier
 * (key, digest, CDN key and number), like when it was received.
 */
function getLivePhotoVideoFilePointer(
  video: AttachmentType
): Backups.FilePointer.Params | null {
  if (
    !video.cdnKey ||
    !isValidAttachmentKey(video.key) ||
    !isValidDigest(video.digest)
  ) {
    return null;
  }
  const hasIncrementalMac =
    typeof video.incrementalMac === 'string' && Boolean(video.chunkSize);
  return {
    contentType: video.contentType,
    fileName: video.fileName ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    caption: null,
    blurHash: null,
    incrementalMac:
      hasIncrementalMac && video.incrementalMac
        ? Bytes.fromBase64(video.incrementalMac)
        : null,
    incrementalMacChunkSize: hasIncrementalMac
      ? (video.chunkSize ?? null)
      : null,
    locatorInfo: {
      key: Bytes.fromBase64(video.key),
      size: video.size,
      integrityCheck: { encryptedDigest: Bytes.fromBase64(video.digest) },
      transitCdnKey: video.cdnKey,
      transitCdnNumber: video.cdnNumber ?? null,
      transitTierUploadTimestamp: getSafeLongFromTimestamp(
        video.uploadTimestamp
      ),
      localKey: null,
      mediaTierCdnNumber: null,
    },
  };
}

/**
 * Import, by the rules of receiving it: a quoted thumbnail is never a file and has no moving half;
 * covered only on images / videos and never when sent as a file; a moving half only on a still, and
 * only a video with where it is, its key and its digest. Anything else is left out and the
 * attachment comes in as usual.
 */
export function applyTellomiAttachmentFromBackup(
  attachment: AttachmentType,
  tellomi: Backups.TellomiAttachment | null | undefined,
  options: BackupImportOptions,
  { quote }: { quote: boolean }
): AttachmentType {
  if (tellomi == null) {
    return attachment;
  }
  const contentType = String(attachment.contentType ?? '').toLowerCase();
  const asFile = !quote && tellomi.asFile;
  const spoiler =
    tellomi.spoiler &&
    !tellomi.asFile &&
    (contentType.startsWith('image/') || contentType.startsWith('video/'));
  const livePhotoVideo =
    !quote &&
    !tellomi.asFile &&
    contentType.startsWith('image/') &&
    tellomi.livePhotoVideo != null
      ? getLivePhotoVideoFromBackup(tellomi.livePhotoVideo, options)
      : undefined;

  return {
    ...attachment,
    ...(asFile ? { tellomiAsFile: true } : {}),
    ...(spoiler ? { tellomiSpoiler: true } : {}),
    ...(livePhotoVideo ? { tellomiLivePhotoVideo: livePhotoVideo } : {}),
  };
}

function getLivePhotoVideoFromBackup(
  filePointer: Backups.FilePointer,
  options: BackupImportOptions
): AttachmentType | undefined {
  const video = convertFilePointerToAttachment(filePointer, options);
  if (
    !String(video.contentType ?? '')
      .toLowerCase()
      .startsWith('video/') ||
    !video.cdnKey ||
    !isValidAttachmentKey(video.key) ||
    !isValidDigest(video.digest) ||
    !(video.size > 0)
  ) {
    return undefined;
  }
  // Fetched when it first plays (TellomiLivePhoto), never queued for download with the message.
  return omit(video, [
    'downloadPath',
    'localBackupPath',
    'localKey',
    'plaintextHash',
    'backupCdnNumber',
  ]);
}
