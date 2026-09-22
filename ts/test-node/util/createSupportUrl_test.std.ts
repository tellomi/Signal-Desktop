// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { createSupportUrl } from '../../util/createSupportUrl.std.ts';

describe('createSupportUrl', () => {
  it('returns support url for "en" locale', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'en' }),
      'https://tellomi.app/support/?lang=en-us&desktop'
    );
  });

  it('returns support url for "fr" locale', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'fr' }),
      'https://tellomi.app/support/?lang=fr&desktop'
    );
  });

  it('returns support url with a query', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'en', query: { debugLog: 'https://' } }),
      'https://tellomi.app/support/?lang=en-us&' +
        'desktop&debugLog=https%3A%2F%2F'
    );
  });
});
