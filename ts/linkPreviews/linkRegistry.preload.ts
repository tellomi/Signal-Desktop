// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer as ipc } from 'electron';
import { join } from 'node:path';
import { LRUCache } from 'lru-cache';
import {
  LinkRegistry,
  layout as bridgeLayout,
  tint as bridgeTint,
} from '@signalapp/libsignal-client/dist/links.js';

import { createLogger } from '../logging/log.std.ts';
import {
  BUNDLED_LINK_ICONS_DIR,
  BUNDLED_LINK_REGISTRY,
} from './bundledLinkRegistry.std.ts';
import type {
  LinkCardType,
  LinkMessageContext,
  LinkPreviewForClassify,
} from './linkCard.std.ts';
import {
  parseLinkCard,
  toMessageContextJson,
  toPreviewInputJson,
} from './linkCard.std.ts';
import type {
  LinkCardLayoutType,
  LinkCardTintType,
} from './linkCardVisual.std.ts';
import {
  parseLinkCardLayout,
  parseLinkCardTint,
} from './linkCardVisual.std.ts';
import type { LinkCardIconType } from './linkCardIcon.std.ts';
import { readBundledLinkIcon } from './linkCardIcon.node.ts';
import { getLinkErrorKind } from './linkLog.std.ts';
import {
  LINK_REGISTRY_UPDATE_DIR,
  loadBestLinkRegistry,
} from './linkRegistryStore.node.ts';
import { parseLinkOpenPlan } from './linkOpenPlan.std.ts';

const log = createLogger('linkRegistry');

// The link registry (ADR-0063 §8.1 rows 2–3): the bundled one, or a hot-updated one on top of it when rust/links
// accepts that (linkRegistryStore.node.ts). The main process downloads updates and says so when one is stored.

let registry: LinkRegistry | undefined;
let loadFailed = false;
let listening = false;

// Who wants to know that the registry in use changed (a hot update was taken): the timeline, whose
// items are memoized and would otherwise keep the cards they were drawn with.
const registryListeners = new Set<() => void>();

const cardCache = new LRUCache<string, LinkCardType | 'none'>({ max: 1000 });
const lookalikeCache = new LRUCache<string, string>({ max: 1000 });
const iconCache = new LRUCache<string, LinkCardIconType | 'none'>({ max: 64 });

function listenForUpdates(): void {
  if (listening) {
    return;
  }
  listening = true;
  // Not there when this module is loaded outside Electron (unit tests).
  ipc?.on?.('link-registry-updated', () => {
    reloadLinkRegistry();
  });
}

function loadRegistry(): void {
  try {
    const { config } = window.SignalContext;
    const loaded = loadBestLinkRegistry({
      bundledPath: join(
        config.installPath,
        'build',
        'links',
        BUNDLED_LINK_REGISTRY
      ),
      updateDir: join(config.userDataPath, LINK_REGISTRY_UPDATE_DIR),
      publicKey: Buffer.from(config.updatesPublicKey, 'hex'),
      deps: {
        load: envelope => LinkRegistry.load(envelope),
        loadUpdate: (envelope, signatureHex, publicKey, currentVersion) =>
          LinkRegistry.loadUpdate(
            envelope,
            signatureHex,
            publicKey,
            currentVersion
          ),
      },
    });
    registry = loaded.registry;
    loadFailed = false;
    log.info(`loaded ${loaded.source} registry ${registry.version}`);
  } catch (error) {
    // Never break message rendering: without a registry every preview shows as Signal does.
    loadFailed = true;
    log.error('failed to load the link registry', error);
  }
}

export function getLinkRegistry(): LinkRegistry | undefined {
  listenForUpdates();
  if (registry || loadFailed) {
    return registry;
  }
  loadRegistry();
  return registry;
}

// The version of the registry cards are decided with, as text ('' when there is none): a value a
// component can hold on to, and that changes exactly when the registry in use does (ADR-0063 §5.4
// row 3, §8.4: a hot update reaches the messages already on screen too).
export function getLinkRegistryVersion(): string {
  // Loads it on first use, so the first answer is the one that stays.
  return getLinkRegistry()?.version.toString() ?? '';
}

export function subscribeToLinkRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

// A newer registry was stored: take it (or stay with the current one when it does not pass). The card caches are keyed
// by registry version, so what is in them is only dropped to free it. Messages drawn from now on use the new registry;
// the ones on screen are memoized and would keep the card they were drawn with, so they are told, and redraw.
/** @testexport */
export function reloadLinkRegistry(): void {
  const before = registry?.version;
  loadRegistry();
  if (registry?.version !== before) {
    cardCache.clear();
    lookalikeCache.clear();
    for (const listener of [...registryListeners]) {
      listener();
    }
  }
}

/** @testexport */
export function _setLinkRegistryForTesting(
  value: LinkRegistry | undefined
): void {
  registry = value;
  loadFailed = false;
  cardCache.clear();
  lookalikeCache.clear();
  iconCache.clear();
}

// Level and contents of the card for one received preview (ADR-0063 §5.1 rule 4: decided in the
// data layer before display, cached per message content and registry version). `undefined` means
// "no decision": show the preview the way Signal does.
export function classifyLinkPreview(
  preview: LinkPreviewForClassify,
  body: string,
  context: LinkMessageContext
): LinkCardType | undefined {
  const current = getLinkRegistry();
  if (!current) {
    return undefined;
  }

  const previewJson = toPreviewInputJson(preview);
  const messageJson = toMessageContextJson(context);
  const key = [current.version, previewJson, body, messageJson].join('\u0000');
  const cached = cardCache.get(key);
  if (cached !== undefined) {
    return cached === 'none' ? undefined : cached;
  }

  let card: LinkCardType | undefined;
  try {
    card = parseLinkCard(current.classify(previewJson, body, messageJson));
  } catch (error) {
    log.warn(`classify failed: ${getLinkErrorKind(error)}`);
    card = undefined;
  }
  if (card?.reason) {
    // Provider, route, level and reason only — never the URL (ADR-0063 §6.5, §8.1 row 9).
    log.debug(
      `card ${card.provider ?? '-'}/${card.route ?? '-'} ${card.level} (${card.reason})`
    );
  }
  cardCache.set(key, card ?? 'none');
  return card;
}

// The well-known domain `url` imitates (ADR-0063 §6.1), from the same `open_plan` that warns
// before opening it (app/linkOpen.main.ts); undefined when it imitates none, or without a
// registry.
export function getLinkLookalike(url: string): string | undefined {
  const current = getLinkRegistry();
  if (!current) {
    return undefined;
  }

  const key = `${current.version}\u0000${url}`;
  const cached = lookalikeCache.get(key);
  if (cached !== undefined) {
    return cached || undefined;
  }

  let lookalike: string | undefined;
  try {
    lookalike =
      parseLinkOpenPlan(current.openPlan(url))?.lookalike ?? undefined;
  } catch (error) {
    log.warn(`openPlan failed: ${getLinkErrorKind(error)}`);
    lookalike = undefined;
  }
  lookalikeCache.set(key, lookalike ?? '');
  return lookalike;
}

// A brand shell's icon (ADR-0063 §九.6): the file rust/links names in the card, read from the icons
// that ship with the app (build/links/icons) — never the network, never the sender's image.
// `undefined` when the card names none, when the file is not bundled (a brand pulled in by a hot
// update), or when it cannot be read: the shell then shows just the name and the domain. The
// files never change while the app runs, so each is read once.
/** @testexport */
export function getBundledLinkIcon(
  fileName: string | null | undefined
): LinkCardIconType | undefined {
  if (!fileName) {
    return undefined;
  }
  const cached = iconCache.get(fileName);
  if (cached !== undefined) {
    return cached === 'none' ? undefined : cached;
  }

  let icon: LinkCardIconType | undefined;
  try {
    const { config } = window.SignalContext;
    icon = readBundledLinkIcon(
      join(config.installPath, 'build', 'links', BUNDLED_LINK_ICONS_DIR),
      fileName
    );
  } catch (error) {
    log.warn(`brand icon failed: ${getLinkErrorKind(error)}`);
    icon = undefined;
  }
  iconCache.set(fileName, icon ?? 'none');
  return icon;
}

// The icon a card shows in place of a picture: only a brand shell has one (card-visual §3.7: "随包
// 图标，有才显示"), and never the sender's image.
export function getLinkCardBrandIcon(
  card: LinkCardType | undefined
): LinkCardIconType | undefined {
  return card?.level === 'brand' ? getBundledLinkIcon(card.icon) : undefined;
}

// Which of the four card shapes (card-visual §3.2), from the pixel size of the image the card shows
// (0 × 0 when it shows none) and its kind and level: one function in rust/links for all platforms,
// so no threshold lives here. `undefined` when it cannot be asked: the card keeps its default look.
export function getLinkCardLayout(
  imageWidth: number,
  imageHeight: number,
  kind: string,
  level: string
): LinkCardLayoutType | undefined {
  if (!isPixelSize(imageWidth) || !isPixelSize(imageHeight)) {
    return undefined;
  }
  try {
    return parseLinkCardLayout(
      bridgeLayout(imageWidth, imageHeight, kind, level)
    );
  } catch (error) {
    log.warn(`layout failed: ${getLinkErrorKind(error)}`);
    return undefined;
  }
}

// The card's colours from its own image (card-visual §3.3), decoded to RGBA and reduced to
// `width` × `height` by the caller. Never called for a first-party or payment card, or inside a
// message request (`shouldTintLinkCard`). `undefined` when it cannot be asked.
export function tintLinkCardImage(
  layout: LinkCardLayoutType,
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBuffer>
): LinkCardTintType | undefined {
  if (!isPixelSize(width) || !isPixelSize(height)) {
    return undefined;
  }
  try {
    return parseLinkCardTint(bridgeTint(layout, width, height, rgba));
  } catch (error) {
    log.warn(`tint failed: ${getLinkErrorKind(error)}`);
    return undefined;
  }
}

function isPixelSize(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
