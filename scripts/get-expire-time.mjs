// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DAY } from './utils/durations.mjs';
import { parseVersion } from './utils/parseVersion.mjs';
import { getBuildCreationTimestamp } from './utils/getBuildCreationTimestamp.mjs';
import packageJson from '../package.json' with { type: 'json' };

const buildCreation = getBuildCreationTimestamp();

const isNotUpdatable = !parseVersion(packageJson.version).isUpdatable;

// NB: the remote build expiration can still shorten this; see getBuildExpirationTimestamp. (Upstream also cut it
// for users with auto-download off; Tellomi doesn't.)
// Tellomi (tellomi/tellomi#1269, spec #1143 §3.6): 180 days, the same on every platform; must match
// BUILD_LIFESPAN_DAYS in ts/util/buildExpiration.std.ts (its safety window is one day longer).
const validDuration = isNotUpdatable ? DAY * 30 : DAY * 180;
const buildExpiration = buildCreation + validDuration;

const localProductionPath = join(
  import.meta.dirname,
  '../config/local-production.json'
);

const localProductionConfig = {
  buildCreation,
  buildExpiration,
  ...(isNotUpdatable ? { updatesEnabled: false } : {}),
};

writeFileSync(
  localProductionPath,
  `${JSON.stringify(localProductionConfig)}\n`
);
