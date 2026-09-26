// Copyright 2017 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { join, basename } from 'node:path';
import { app } from 'electron';

import type { Config } from 'config';

import {
  Environment,
  getEnvironment,
  setEnvironment,
  parseEnvironment,
} from '../ts/environment.std.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import { getAppRootDir } from '../ts/util/appRootDir.main.ts';
import {
  applyRegionEndpoints,
  getEnabledRegions,
  getRegionEndpoints,
  parseRegions,
  selectStartupRegion,
} from '../ts/util/tellomiRegion.std.ts';
import type { RegionIdType } from '../ts/util/tellomiRegion.std.ts';

const log = createLogger('config');

// In production mode, NODE_ENV cannot be customized by the user
if (app.isPackaged) {
  setEnvironment(Environment.PackagedApp, false);
} else {
  setEnvironment(
    parseEnvironment(process.env.NODE_ENV || 'development'),
    Boolean(process.env.MOCK_TEST)
  );
}

// Set environment vars to configure node-config before requiring it
process.env.NODE_ENV = getEnvironment();

if (process.env.NODE_ENV === Environment.Test) {
  // Necessary for `tsx` to work in preload (there are no worker_threads)
  process.env.ESBUILD_WORKER_THREADS = '0';
}

if (getEnvironment() === Environment.PackagedApp) {
  // harden production config against the local env
  process.env.NODE_CONFIG = '';
  process.env.NODE_CONFIG_STRICT_MODE = '';
  process.env.HOSTNAME = '';
  process.env.NODE_APP_INSTANCE = '';
  process.env.ALLOW_CONFIG_MUTATIONS = '';
  process.env.SUPPRESS_NO_CONFIG_WARNING = '';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '';
  process.env.SIGNAL_ENABLE_HTTP = '';
  process.env.SIGNAL_CI_CONFIG = '';
  process.env.GENERATE_PRELOAD_CACHE = '';
  process.env.REACT_DEVTOOLS = '';
  process.env.IS_BUNDLED = '1';
}

// Call `getAppRootDir()` after hardening since it relies on env variables
process.env.NODE_CONFIG_DIR = join(getAppRootDir(), 'config');

// We load config after we've made our modifications to NODE_ENV
// Note: we use `require()` because esbuild moves the imports to the top of
// the module regardless of their actual placement in the file.
// See: https://github.com/evanw/esbuild/issues/2011
// oxlint-disable-next-line typescript/no-var-requires
const config: Config = require('config');

// Tellomi (ADR-0065 §6.6, tellomi/tellomi#1054): production.json keeps its endpoints per region.
// Copy the startup region's endpoints over the flat keys before anything calls `config.get()`
// (the first get() freezes the object), so every reader sees the region's values. An invalid
// `regions` block throws here: the app must never start on whatever default.json holds
// (tellomi/tellomi#1023). Environments without `regions` (development, test) are untouched.
function applyStartupRegion(): RegionIdType {
  const target = config as unknown as Record<string, unknown>;
  const regions = parseRegions(target.regions);
  const id = selectStartupRegion(regions);
  applyRegionEndpoints(target, getRegionEndpoints(regions, id));
  log.info(`region ${id} (enabled: ${getEnabledRegions(regions).join(', ')})`);
  return id;
}

// A packaged build without `regions` would silently run on default.json, which points at
// Signal's staging servers: refuse to start instead.
if (getEnvironment() === Environment.PackagedApp && !config.has('regions')) {
  throw new Error(
    'config: production build has no "regions" block (tellomi/tellomi#1054)'
  );
}

export const region: RegionIdType | undefined = config.has('regions')
  ? applyStartupRegion()
  : undefined;

if (getEnvironment() !== Environment.PackagedApp) {
  config.util.getConfigSources().forEach(source => {
    log.info(`Using config source ${basename(source.name)}`);
  });
}

// Log resulting env vars in use by config
[
  'NODE_ENV',
  'NODE_CONFIG_DIR',
  'NODE_CONFIG',
  'ALLOW_CONFIG_MUTATIONS',
  'HOSTNAME',
  'NODE_APP_INSTANCE',
  'SUPPRESS_NO_CONFIG_WARNING',
  'SIGNAL_ENABLE_HTTP',
].forEach(s => {
  // oxlint-disable-next-line no-console
  console.log(`${s} ${config.util.getEnv(s)}`);
});

export default config;
export type { Config as ConfigType };
