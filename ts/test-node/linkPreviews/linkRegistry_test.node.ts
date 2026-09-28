// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import { LinkRegistry } from '@signalapp/libsignal-client/dist/links.js';

// tellomi/tellomi#1418 / #1421: the vendored libsignal-client carries rust/links and its node
// bridge. Load a registry dist and classify one golden sample exactly the way Rust does (the sample
// is copied from libsignal's rust/links/tests/data/bridge-golden.json).

type Sample = Readonly<{
  registry: string;
  registry_version: number;
  preview: string;
  body: string;
  message: string;
  card: string;
}>;

const FIXTURES = join(cwd(), 'fixtures', 'links');
const sample: Sample = JSON.parse(
  readFileSync(join(FIXTURES, 'classify-smoke.json'), 'utf8')
);

function loadRegistry(): LinkRegistry {
  return LinkRegistry.load(
    new Uint8Array(readFileSync(join(FIXTURES, sample.registry)))
  );
}

describe('LinkRegistry (vendored libsignal-client)', () => {
  it('loads the registry dist', () => {
    assert.strictEqual(loadRegistry().version, BigInt(sample.registry_version));
  });

  it('classifies a golden sample byte for byte', () => {
    assert.strictEqual(
      loadRegistry().classify(sample.preview, sample.body, sample.message),
      sample.card
    );
  });
});
