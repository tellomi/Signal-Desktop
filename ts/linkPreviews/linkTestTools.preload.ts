// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { getEnvironment } from '../environment.std.ts';
import { createLogger } from '../logging/log.std.ts';
import * as Bytes from '../Bytes.std.ts';
import { sha256 } from '../Crypto.node.ts';
import * as VisualAttachment from '../types/VisualAttachment.dom.ts';
import type { LinkPreviewWithHydratedData } from '../types/message/LinkPreviews.std.ts';
import { imageToBlurHash } from '../util/imageToBlurHash.dom.ts';
import { getMessageIdForLogging } from '../util/idForLogging.preload.ts';
import type { LinkTestToolsWhereType } from './linkTestToolsGate.std.ts';
import { isLinkTestToolsEnabled } from './linkTestToolsGate.std.ts';
import type { TestLinkPreviewPayload } from './testLinkPreview.std.ts';
import { buildTestLinkPreview } from './testLinkPreview.std.ts';

const log = createLogger('linkTestTools');

// What `sendTestLinkPreview` hands back: enough to find the message again, and the bytes of `rich`
// as they were queued (what the receiving end should get, verbatim, when they are in the order
// every encoder writes them).
export type SendTestLinkPreviewResultType = Readonly<{
  messageId: string;
  timestamp: number;
  richBase64: string | undefined;
  richLength: number | undefined;
}>;

export type LinkTestToolsType = Readonly<{
  // Sends a message whose link preview is exactly what `payload` says, through the app's own
  // send path (the job queue, encryption, the attachment upload), to the conversation `target`
  // names: its id, or the service id, phone number or group id it is known by. Resolves once the
  // message is queued; its delivery is the send job's, as for any message.
  sendTestLinkPreview: (
    target: string,
    payload: TestLinkPreviewPayload
  ) => Promise<SendTestLinkPreviewResultType>;
}>;

// The picture of the preview the way a link preview's picture is made for sending
// (LinkPreview.preload.ts `toImageAttachment`): its hash, its size in pixels and its blur hash,
// except that nothing is rescaled or re-encoded, so the bytes that arrive are the bytes given,
// and a size the payload gives is kept, true or not.
async function measurePicture(
  preview: LinkPreviewWithHydratedData
): Promise<LinkPreviewWithHydratedData> {
  const { image } = preview;
  if (!image) {
    return preview;
  }

  const blob = new Blob([image.data], { type: image.contentType });
  let { width, height } = image;
  let blurHash = image.blurHash;
  const objectUrl = URL.createObjectURL(blob);
  try {
    if (width === undefined || height === undefined) {
      const measured = await VisualAttachment.getImageDimensions({
        objectUrl,
        logger: log,
      });
      width ??= measured.width;
      height ??= measured.height;
    }
    blurHash ??= await imageToBlurHash(blob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return {
    ...preview,
    image: {
      ...image,
      width,
      height,
      blurHash,
      plaintextHash: Bytes.toHex(sha256(image.data)),
    },
  };
}

async function sendTestLinkPreview(
  target: string,
  payload: TestLinkPreviewPayload
): Promise<SendTestLinkPreviewResultType> {
  const conversation = window.ConversationController.get(target);
  if (!conversation) {
    throw new Error('sendTestLinkPreview: no conversation for that target');
  }

  const { body, preview: built, richBytes } = buildTestLinkPreview(payload);
  const preview = await measurePicture(built);

  const attributes = await conversation.enqueueMessageForSend({
    body,
    attachments: [],
    preview: [preview],
  });
  if (!attributes) {
    throw new Error('sendTestLinkPreview: the message was not queued');
  }

  // The message, not the link: what is sent is the tool's business, what is logged is not.
  log.info(`sendTestLinkPreview: queued ${getMessageIdForLogging(attributes)}`);
  return {
    messageId: attributes.id,
    timestamp: attributes.sent_at,
    richBase64: built.rich,
    richLength: richBytes?.byteLength,
  };
}

// `undefined` where the tools do not exist (see linkTestToolsGate.std.ts): the caller exposes
// nothing then.
export function createLinkTestTools(
  where: LinkTestToolsWhereType = {
    environment: getEnvironment(),
    ciMode: window.SignalContext.config.ciMode,
  }
): LinkTestToolsType | undefined {
  if (!isLinkTestToolsEnabled(where)) {
    return undefined;
  }
  return { sendTestLinkPreview };
}
