// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0063 §8.1 row 3: the link registry that ships with the app, under build/links (see
// package.json build.files). Both the renderer (classify) and the main process (open plan) load it.
export const BUNDLED_LINK_REGISTRY = 'links-2026092702.json';
