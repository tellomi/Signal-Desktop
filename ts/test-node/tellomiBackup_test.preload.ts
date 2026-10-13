// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import * as Bytes from '../Bytes.std.ts';
import { Backups } from '../protobuf/index.std.ts';
import { convertBackupMessageAttachmentToAttachment } from '../services/backups/util/filePointers.preload.ts';
import {
  applyTellomiAttachmentFromBackup,
  getTellomiAttachmentForBackup,
} from '../services/backups/util/tellomi.preload.ts';
import type { AttachmentType } from '../types/Attachment.std.ts';
import {
  AUDIO_MP3,
  IMAGE_JPEG,
  VIDEO_MP4,
  type MIMEType,
} from '../types/MIME.std.ts';
import type { BackupImportOptions } from '../services/backups/types.std.ts';

// ADR-0068 §4.5 (tellomi/tellomi#1263): how an attachment is presented goes into a backup and
// comes back out by the rules of receiving it.
describe('Tellomi: attachments in backups (ADR-0068 §4.5)', () => {
  const OPTIONS: BackupImportOptions = { type: 'remote' };
  const KEY = Bytes.toBase64(new Uint8Array(64).fill(7));
  const DIGEST = Bytes.toBase64(new Uint8Array(32).fill(9));

  function still(overrides: Partial<AttachmentType> = {}): AttachmentType {
    return {
      contentType: IMAGE_JPEG,
      size: 1000,
      cdnKey: 'cdn-key-still',
      cdnNumber: 3,
      key: KEY,
      digest: DIGEST,
      ...overrides,
    };
  }

  const liveVideo: AttachmentType = {
    contentType: VIDEO_MP4,
    size: 456789,
    cdnKey: 'cdn-key-video',
    cdnNumber: 3,
    key: KEY,
    digest: DIGEST,
    uploadTimestamp: 1700000000000,
    width: 1080,
    height: 1920,
  };

  /** What another device would read: through the bytes of a `MessageAttachment`. */
  function roundtrip(
    tellomi: Backups.TellomiAttachment.Params | null,
    contentType: MIMEType = IMAGE_JPEG
  ): { attachment: AttachmentType; tellomi: Backups.TellomiAttachment | null } {
    const bytes = Backups.MessageAttachment.encode({
      pointer: {
        contentType,
        fileName: null,
        width: null,
        height: null,
        caption: null,
        blurHash: null,
        incrementalMac: null,
        incrementalMacChunkSize: null,
        locatorInfo: {
          key: Bytes.fromBase64(KEY),
          size: 1000,
          integrityCheck: { encryptedDigest: Bytes.fromBase64(DIGEST) },
          transitCdnKey: 'cdn-key-still',
          transitCdnNumber: 3,
          transitTierUploadTimestamp: null,
          localKey: null,
          mediaTierCdnNumber: null,
        },
      },
      flag: Backups.MessageAttachment.Flag.NONE,
      wasDownloaded: false,
      clientUuid: null,
      tellomi,
    });
    const decoded = Backups.MessageAttachment.decode(bytes);
    const attachment = convertBackupMessageAttachmentToAttachment(
      decoded,
      OPTIONS
    );
    assert.isNotNull(attachment);
    return {
      attachment,
      tellomi: decoded.tellomi,
    };
  }

  it('nothing Tellomi, nothing in the backup', () => {
    assert.isNull(getTellomiAttachmentForBackup(still()));
    const { attachment, tellomi } = roundtrip(null);
    assert.isNull(tellomi);
    const imported = applyTellomiAttachmentFromBackup(
      attachment,
      tellomi,
      OPTIONS,
      { quote: false }
    );
    assert.isUndefined(imported.tellomiAsFile);
    assert.isUndefined(imported.tellomiSpoiler);
    assert.isUndefined(imported.tellomiLivePhotoVideo);
  });

  it('as a file and covered go out; uncovered on this device does not', () => {
    assert.deepEqual(
      getTellomiAttachmentForBackup(still({ tellomiAsFile: true })),
      { asFile: true, spoiler: false, livePhotoVideo: null }
    );
    assert.deepEqual(
      getTellomiAttachmentForBackup(
        still({ tellomiSpoiler: true, tellomiSpoilerRevealed: true })
      ),
      { asFile: false, spoiler: true, livePhotoVideo: null }
    );
  });

  it("a live photo's moving half goes out as a transit pointer and comes back the same", () => {
    const exported = getTellomiAttachmentForBackup(
      still({ tellomiLivePhotoVideo: liveVideo })
    );
    assert.isNotNull(exported);
    const locator = exported?.livePhotoVideo?.locatorInfo;
    assert.strictEqual(locator?.transitCdnKey, 'cdn-key-video');
    assert.deepEqual(locator?.integrityCheck, {
      encryptedDigest: Bytes.fromBase64(DIGEST),
    });

    const { attachment, tellomi } = roundtrip(exported);
    const imported = applyTellomiAttachmentFromBackup(
      attachment,
      tellomi,
      OPTIONS,
      { quote: false }
    );
    const video = imported.tellomiLivePhotoVideo;
    assert.strictEqual(video?.contentType, VIDEO_MP4);
    assert.strictEqual(video?.cdnKey, 'cdn-key-video');
    assert.strictEqual(video?.cdnNumber, 3);
    assert.strictEqual(video?.key, KEY);
    assert.strictEqual(video?.digest, DIGEST);
    assert.strictEqual(video?.size, 456789);
    // Fetched when it first plays, never queued with the message
    assert.isUndefined(video?.downloadPath);
  });

  it('coming back, the rules of receiving apply', () => {
    const live = getTellomiAttachmentForBackup(
      still({ tellomiLivePhotoVideo: liveVideo })
    )?.livePhotoVideo;
    assert.isOk(live);

    const imported = (
      tellomi: Backups.TellomiAttachment.Params,
      contentType: MIMEType = IMAGE_JPEG,
      quote = false
    ): AttachmentType => {
      const result = roundtrip(tellomi, contentType);
      return applyTellomiAttachmentFromBackup(
        result.attachment,
        result.tellomi,
        OPTIONS,
        { quote }
      );
    };

    // A quoted thumbnail is never a file and has no moving half, but stays covered
    const quoted = imported(
      { asFile: true, spoiler: false, livePhotoVideo: live ?? null },
      IMAGE_JPEG,
      true
    );
    assert.isUndefined(quoted.tellomiAsFile);
    assert.isUndefined(quoted.tellomiLivePhotoVideo);
    assert.isTrue(
      imported(
        { asFile: false, spoiler: true, livePhotoVideo: null },
        IMAGE_JPEG,
        true
      ).tellomiSpoiler
    );

    // As a file wins
    const asFile = imported({
      asFile: true,
      spoiler: true,
      livePhotoVideo: live ?? null,
    });
    assert.isTrue(asFile.tellomiAsFile);
    assert.isUndefined(asFile.tellomiSpoiler);
    assert.isUndefined(asFile.tellomiLivePhotoVideo);

    // Covered only on images and videos
    assert.isUndefined(
      imported(
        { asFile: false, spoiler: true, livePhotoVideo: null },
        AUDIO_MP3
      ).tellomiSpoiler
    );
    assert.isTrue(
      imported(
        { asFile: false, spoiler: true, livePhotoVideo: null },
        VIDEO_MP4
      ).tellomiSpoiler
    );

    // A moving half only on a still, and only a video with where it is, its key and its digest
    assert.isUndefined(
      imported(
        { asFile: false, spoiler: false, livePhotoVideo: live ?? null },
        VIDEO_MP4
      ).tellomiLivePhotoVideo
    );
    assert.isUndefined(
      imported({
        asFile: false,
        spoiler: false,
        livePhotoVideo: live ? { ...live, contentType: IMAGE_JPEG } : null,
      }).tellomiLivePhotoVideo
    );
    assert.isUndefined(
      imported({
        asFile: false,
        spoiler: false,
        livePhotoVideo:
          live?.locatorInfo != null
            ? {
                ...live,
                locatorInfo: { ...live.locatorInfo, integrityCheck: null },
              }
            : null,
      }).tellomiLivePhotoVideo
    );
    assert.isUndefined(
      imported({
        asFile: false,
        spoiler: false,
        livePhotoVideo:
          live?.locatorInfo != null
            ? {
                ...live,
                locatorInfo: { ...live.locatorInfo, transitCdnKey: null },
              }
            : null,
      }).tellomiLivePhotoVideo
    );
    assert.isOk(
      imported({
        asFile: false,
        spoiler: false,
        livePhotoVideo: live ?? null,
      }).tellomiLivePhotoVideo
    );
  });
});
