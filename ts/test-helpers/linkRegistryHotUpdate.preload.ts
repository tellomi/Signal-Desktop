// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';
import type { PrivateKey } from '@signalapp/libsignal-client';

import * as Bytes from '../Bytes.std.ts';
import { BUNDLED_LINK_REGISTRY } from '../linkPreviews/bundledLinkRegistry.std.ts';
import {
  LINK_REGISTRY_UPDATE_DIR,
  saveLinkRegistryUpdate,
} from '../linkPreviews/linkRegistryStore.node.ts';
import type { MessageWithUIFieldsType } from '../state/ducks/conversations.preload.ts';
import { noopAction } from '../state/ducks/noop.std.ts';
import type { StateType } from '../state/reducer.preload.ts';
import { reducer as rootReducer } from '../state/reducer.preload.ts';
import { IMAGE_JPEG } from '../types/MIME.std.ts';
import { getDefaultConversation } from './getDefaultConversation.std.ts';

// Shared by the tests of a hot update of the link registry (ADR-0063 §5.4 row 3, §8.4 third bullet):
// the registry that ships with the app, a really signed newer one that makes bilibili a brand shell,
// and the state of a conversation holding an old message that came in as a structured bilibili card.

const FIXTURES = join(cwd(), 'fixtures', 'links');

const golden: Readonly<{
  classify: ReadonlyArray<
    Readonly<{ name: string; preview: string; body: string }>
  >;
}> = JSON.parse(readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8'));

const bundledBytes = new Uint8Array(
  readFileSync(join(cwd(), 'build', 'links', BUNDLED_LINK_REGISTRY))
);

export const BUNDLED_VERSION = BigInt(
  (
    JSON.parse(Buffer.from(bundledBytes).toString('utf8')) as {
      version: number;
    }
  ).version
);

export type SignedUpdate = Readonly<{
  version: bigint;
  bytes: Uint8Array<ArrayBuffer>;
  signatureHex: string;
}>;

// The bundled envelope with a newer version and bilibili as a brand shell (plan none on every route:
// the loader refuses `tier = brand` with any other plan), signed like scripts/links/build.py does.
export function makeBilibiliBrandUpdate(
  signer: PrivateKey,
  version: bigint = BUNDLED_VERSION + 1n
): SignedUpdate {
  const envelope = JSON.parse(Buffer.from(bundledBytes).toString('utf8'));
  const provider = envelope.payload.providers.find(
    (item: { id: string }) => item.id === 'bilibili'
  );
  provider.tier = 'brand';
  for (const route of provider.route) {
    route.plan = [{ type: 'none' }];
  }
  envelope.version = Number(version);
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(envelope)));
  return {
    version,
    bytes,
    signatureHex: Buffer.from(signer.sign(bytes)).toString('hex'),
  };
}

type HotUpdateConfig = {
  installPath?: string;
  userDataPath?: string;
  updatesPublicKey?: string;
};

// Points the renderer at this checkout for the bundled registry, at a temporary user data directory
// for downloaded ones, and at `signer` as the update key. `restore` puts everything back.
export function setUpHotUpdateEnvironment(signer: PrivateKey): {
  userDataPath: string;
  install(update: SignedUpdate): void;
  restore(): void;
} {
  const config = window.SignalContext.config as HotUpdateConfig;
  const saved = {
    installPath: config.installPath,
    userDataPath: config.userDataPath,
    updatesPublicKey: config.updatesPublicKey,
  };
  const userDataPath = mkdtempSync(join(tmpdir(), 'link-registry-hot-update-'));
  config.installPath = cwd();
  config.userDataPath = userDataPath;
  config.updatesPublicKey = Buffer.from(
    signer.getPublicKey().serialize()
  ).toString('hex');
  return {
    userDataPath,
    install: update =>
      saveLinkRegistryUpdate(
        join(userDataPath, LINK_REGISTRY_UPDATE_DIR),
        Number(update.version),
        update.bytes,
        update.signatureHex
      ),
    restore: () => {
      Object.assign(config, saved);
      rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

const FRIEND = getDefaultConversation({ id: 'friend' });

export const OLD_PREVIEW_TITLE = (() => {
  const found = golden.classify.find(testCase =>
    testCase.name.startsWith('structured video: sender level 2')
  );
  if (!found) {
    throw new Error('the golden sample is missing');
  }
  return (JSON.parse(found.preview) as { title: string }).title;
})();

// The state of a conversation with one incoming message: a bilibili video that came in with the
// sender's rich content (structured, level 2), as `handleDataMessage` stored it: the snapshot, the
// picture, and the raw rich bytes.
export function makeOldStructuredVideoState(): {
  state: StateType;
  messageId: string;
  conversationId: string;
} {
  const found = golden.classify.find(testCase =>
    testCase.name.startsWith('structured video: sender level 2')
  );
  if (!found) {
    throw new Error('the golden sample is missing');
  }
  const preview: { url: string; title: string; rich: string } = JSON.parse(
    found.preview
  );
  const empty = rootReducer(undefined, noopAction('linkRegistryHotUpdate'));
  const message = {
    id: 'message-1',
    conversationId: FRIEND.id,
    type: 'incoming',
    body: found.body,
    sent_at: 1_700_000_000_000,
    timestamp: 1_700_000_000_000,
    received_at: 1,
    received_at_ms: 1_700_000_000_000,
    sourceServiceId: FRIEND.serviceId,
    preview: [
      {
        url: preview.url,
        title: preview.title,
        description: '',
        rich: Bytes.toBase64(Bytes.fromHex(preview.rich)),
        image: {
          contentType: IMAGE_JPEG,
          size: 10_000,
          width: 1200,
          height: 630,
          path: 'ab/abcdef',
        },
      },
    ],
  } as unknown as MessageWithUIFieldsType;
  return {
    messageId: message.id,
    conversationId: FRIEND.id,
    state: {
      ...empty,
      conversations: {
        ...empty.conversations,
        conversationLookup: { [FRIEND.id]: FRIEND },
        messagesLookup: { [message.id]: message },
      },
    },
  };
}
