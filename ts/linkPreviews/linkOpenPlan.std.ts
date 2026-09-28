// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';

import { localizedNameSchema } from './linkCard.std.ts';

// ADR-0063 §4.9 / §5.5 / §6.1: how to open a link, from rust/links' `open_plan` (the JSON shape
// is `rust/links/src/open.rs` `OpenPlan`). The target is always the URL itself; the plan only says
// which way to hand it over, and whether to warn first.

const openStepSchema = z.object({
  type: z.enum([
    'in_app',
    'installed_app_only',
    'scheme',
    'browser',
    'copy_link',
  ]),
  url: z.string(),
});

const openPlanSchema = z.object({
  steps: z.array(openStepSchema),
  label: z.enum(['open_link', 'open_in_app', 'leaves_to', 'in_app']),
  app_name: localizedNameSchema.nullable(),
  lookalike: z.string().nullable(),
});

export type LinkOpenPlanType = ReadonlyDeep<z.infer<typeof openPlanSchema>>;

export function parseLinkOpenPlan(json: string): LinkOpenPlanType | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const result = openPlanSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export type DesktopOpenAction =
  | Readonly<{ type: 'none' }>
  | Readonly<{
      type: 'browser';
      url: string;
      // Warn once before opening: the domain imitates this well-known one (§6.1).
      lookalike: string | undefined;
      // If even the browser fails: copy the link and say so (§5.5).
      copyOnFailure: boolean;
    }>;

// Desktop has no "installed app only" and no scheme step (§4.9): third-party links, payment
// included, go straight to the default browser via `shell.openExternal`. tell.cc links are routed
// in-app before this (signalRoutes); one that the router did not take opens in the browser too.
// No plan (the registry did not load): open it the way Signal does.
export function getDesktopOpenAction(
  url: string,
  plan: LinkOpenPlanType | undefined
): DesktopOpenAction {
  if (!plan) {
    return { type: 'browser', url, lookalike: undefined, copyOnFailure: false };
  }
  const step =
    plan.steps.find(({ type }) => type === 'browser') ??
    plan.steps.find(({ type }) => type === 'in_app');
  if (!step) {
    // Not an http(s) URL (`intent:`, `javascript:`, `data:`, `file:`): never a target.
    return { type: 'none' };
  }
  return {
    type: 'browser',
    url: step.url,
    lookalike: plan.lookalike ?? undefined,
    copyOnFailure: plan.steps.some(({ type }) => type === 'copy_link'),
  };
}
