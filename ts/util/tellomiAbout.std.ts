// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// docs/product/specs/about-page.md §3.2 / §3.3 (tellomi/tellomi#1400): what the About window lists. Only what Tellomi
// really has (no phone number, no `hello@` / `admin@`, which BRAND.md keeps out of the app), and no GitHub address: the
// source code is announced with the AGPLv3 sentence and www.tellomi.app/source (owner 2026-09-25).

export const ABOUT_WEBSITE_URL = new URL('https://www.tellomi.app/');
export const ABOUT_TERMS_URL = 'https://www.tellomi.app/legal/terms/';
export const ABOUT_PRIVACY_URL = 'https://www.tellomi.app/legal/privacy/';
export const ABOUT_SOURCE_URL = 'https://www.tellomi.app/source';

export const ABOUT_CONTACTS = [
  { label: 'icu:About__ContactSupport', address: 'support@tellomi.app' },
  { label: 'icu:About__ContactPrivacy', address: 'privacy@tellomi.app' },
  { label: 'icu:About__ContactAbuse', address: 'abuse@tellomi.app' },
] as const;
