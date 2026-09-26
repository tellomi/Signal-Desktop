// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from 'zod';

import { Environment } from '../environment.std.ts';
import { HourCyclePreferenceSchema } from './I18N.std.ts';
import { DNSFallbackSchema } from './DNSFallback.std.ts';
import { themeSettingSchema } from '../util/theme.std.ts';
import { REGION_IDS } from '../util/tellomiRegion.std.ts';

const environmentSchema = z.nativeEnum(Environment);

const configRequiredStringSchema = z.string().nonempty();
export type ConfigRequiredStringType = z.infer<
  typeof configRequiredStringSchema
>;

const configOptionalStringSchema = configRequiredStringSchema.or(z.undefined());
export type configOptionalStringType = z.infer<
  typeof configOptionalStringSchema
>;

export const rendererConfigSchema = z.object({
  appInstance: configOptionalStringSchema,
  appStartInitialSpellcheckSetting: z.boolean(),
  buildCreation: z.number(),
  buildExpiration: z.number(),
  cdnUrl0: configRequiredStringSchema,
  cdnUrl2: configRequiredStringSchema,
  cdnUrl3: configRequiredStringSchema,
  challengeUrl: configRequiredStringSchema,
  certificateAuthority: configRequiredStringSchema,
  contentProxyUrl: configRequiredStringSchema,
  crashDumpsPath: configRequiredStringSchema,
  ciMode: z.enum(['full', 'benchmark']).or(z.literal(false)),
  ciForceUnprocessed: z.boolean(),
  devTools: z.boolean(),
  disableIPv6: z.boolean(),
  disableScreenSecurity: z.boolean(),
  dnsFallback: DNSFallbackSchema,
  environment: environmentSchema,
  isMockTestEnvironment: z.boolean(),
  homePath: configRequiredStringSchema,
  hostname: configRequiredStringSchema,
  installPath: configRequiredStringSchema,
  osRelease: configRequiredStringSchema,
  osVersion: configRequiredStringSchema,
  // Tellomi (tellomi/tellomi#1101, #1054): the outage DNS record of the current region.
  outageCheckHost: configRequiredStringSchema,
  availableLocales: z.array(configRequiredStringSchema),
  resolvedTranslationsLocale: configRequiredStringSchema,
  resolvedTranslationsLocaleDirection: z.enum(['ltr', 'rtl']),
  hourCyclePreference: HourCyclePreferenceSchema,
  preferredSystemLocales: z.array(configRequiredStringSchema),
  localeOverride: z.string().nullable(),
  name: configRequiredStringSchema,
  nodeVersion: configRequiredStringSchema,
  proxyUrl: configOptionalStringSchema,
  reducedMotionSetting: z.boolean(),
  // Tellomi (ADR-0065, tellomi/tellomi#1054): the region whose endpoints this config carries;
  // undefined in environments without a `regions` block (development, test).
  region: z.enum(REGION_IDS).or(z.undefined()),
  registrationChallengeUrl: configRequiredStringSchema,
  serverPublicParams: configRequiredStringSchema,
  serverTrustRoots: z.array(configRequiredStringSchema),
  genericServerPublicParams: configRequiredStringSchema,
  backupServerPublicParams: configRequiredStringSchema,
  serverUrl: configRequiredStringSchema,
  // Tellomi: libsignal 的聊天主机（Omnibus，websocket / gRPC）；不填 = serverUrl 的主机名。
  libsignalHostname: configOptionalStringSchema,
  sfuUrl: configRequiredStringSchema,
  storageUrl: configRequiredStringSchema,
  stripePublishableKey: configRequiredStringSchema,
  theme: themeSettingSchema,
  updatesUrl: configRequiredStringSchema,
  resourcesUrl: configRequiredStringSchema,
  userDataPath: configRequiredStringSchema,
  version: configRequiredStringSchema,

  // Only used by main window
  isMainWindowFullScreen: z.boolean(),
  isMainWindowMaximized: z.boolean(),

  // Only for tests
  argv: configOptionalStringSchema,
});

export type RendererConfigType = z.infer<typeof rendererConfigSchema>;
