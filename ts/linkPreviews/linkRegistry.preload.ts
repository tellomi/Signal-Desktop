// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LRUCache } from 'lru-cache';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

import { createLogger } from '../logging/log.std.ts';
import { BUNDLED_LINK_REGISTRY } from './bundledLinkRegistry.std.ts';
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
import { parseLinkOpenPlan } from './linkOpenPlan.std.ts';

const log = createLogger('linkRegistry');

// The bundled registry (ADR-0063 §8.1 row 3). Hot updates for Desktop come later; until then this
// is the only registry.

let registry: LinkRegistry | undefined;
let loadFailed = false;

const cardCache = new LRUCache<string, LinkCardType | 'none'>({ max: 1000 });
const lookalikeCache = new LRUCache<string, string>({ max: 1000 });

export function getLinkRegistry(): LinkRegistry | undefined {
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
  lookalikeCache.clear();
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
    log.warn('openPlan failed', error);
    lookalike = undefined;
  }
  lookalikeCache.set(key, lookalike ?? '');
  return lookalike;
}
