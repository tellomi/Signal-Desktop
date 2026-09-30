// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  ABOUT_CONTACTS,
  ABOUT_PRIVACY_URL,
  ABOUT_SOURCE_URL,
  ABOUT_TERMS_URL,
  ABOUT_WEBSITE_URL,
} from '../../util/tellomiAbout.std.ts';

// docs/product/specs/about-page.md §3.2 / §3.3 (tellomi/tellomi#1400).

describe('About window contents', () => {
  it('lists the three addresses BRAND.md allows in the app, and no others', () => {
    assert.deepEqual(
      ABOUT_CONTACTS.map(contact => contact.address),
      ['support@tellomi.app', 'privacy@tellomi.app', 'abuse@tellomi.app']
    );
  });

  it('points the legal pages and the source page at the official site over https', () => {
    for (const url of [
      ABOUT_TERMS_URL,
      ABOUT_PRIVACY_URL,
      ABOUT_SOURCE_URL,
      ABOUT_WEBSITE_URL.href,
    ]) {
      const parsed = new URL(url);
      assert.strictEqual(parsed.protocol, 'https:', url);
      assert.strictEqual(parsed.host, 'www.tellomi.app', url);
    }
    assert.strictEqual(new URL(ABOUT_TERMS_URL).pathname, '/legal/terms/');
    assert.strictEqual(new URL(ABOUT_PRIVACY_URL).pathname, '/legal/privacy/');
    assert.strictEqual(new URL(ABOUT_SOURCE_URL).pathname, '/source');
  });

  it('never shows a GitHub address (the source is announced through the site)', () => {
    const shown = JSON.stringify([
      ABOUT_CONTACTS,
      ABOUT_TERMS_URL,
      ABOUT_PRIVACY_URL,
      ABOUT_SOURCE_URL,
      ABOUT_WEBSITE_URL.href,
    ]);
    assert.notInclude(shown, 'github');
  });
});
