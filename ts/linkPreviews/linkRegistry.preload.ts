// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LRUCache } from 'lru-cache';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import { createLogger } from '../logging/log.std.ts';
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

const log = createLogger('linkRegistry');

// ADR-0063 §8.1 row 3: the registry ships with the app (build/links, see package.json
// build.files). Hot updates for Desktop come later; until then this is the only registry.
const BUNDLED_LINK_REGISTRY = 'links-2026092702.json';

let registry: LinkRegistry | undefined;
let loadFailed = false;

const cardCache = new LRUCache<string, LinkCardType | 'none'>({ max: 1000 });

function getRegistry(): LinkRegistry | undefined {
  if (registry || loadFailed) {
    return registry;
  }
  try {
    const path = join(
      window.SignalContext.config.installPath,
      'build',
      'links',
      BUNDLED_LINK_REGISTRY
    );
    registry = LinkRegistry.load(new Uint8Array(readFileSync(path)));
    log.info(`loaded bundled registry ${registry.version}`);
  } catch (error) {
    // Never break message rendering: without a registry every preview shows as Signal does.
    loadFailed = true;
    log.error('failed to load the bundled registry', error);
  }
  return registry;
}

/** @testexport */
export function _setLinkRegistryForTesting(
  value: LinkRegistry | undefined
): void {
  registry = value;
  loadFailed = false;
  cardCache.clear();
}

// Level and contents of the card for one received preview (ADR-0063 §5.1 rule 4: decided in the
// data layer before display, cached per message content and registry version). `undefined` means
// "no decision": show the preview the way Signal does.
export function classifyLinkPreview(
  preview: LinkPreviewForClassify,
  body: string,
  context: LinkMessageContext
): LinkCardType | undefined {
  const current = getRegistry();
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
    log.warn('classify failed', error);
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
