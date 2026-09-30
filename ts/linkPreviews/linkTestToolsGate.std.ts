// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { Environment } from '../environment.std.ts';

// Where the tools for testing link previews exist (ADR-0063 §8.1 row 2): in a build that is run
// from its sources, and in the end-to-end runs against the mock server; never in a build that was
// packaged and handed out. There is no switch to turn it on in one: where it is not enabled the
// object is not made and nothing is exposed, so `window.TellomiTestTools` is `undefined`, not an
// object that refuses.
//
// Two facts decide it, both fixed before the page loads:
// - the environment. A packaged app is `PackagedApp`; a run from the sources is `Development`
//   (or `Test`, `Staging`);
// - the CI mode. The end-to-end runs (`ts/test-mock`) start the app with `SIGNAL_CI_CONFIG`, and
//   the app then tells its windows it is `PackagedApp` so that it behaves like a release (see
//   `environment` in app/main.main.ts); the CI mode is what says it is a test run. A packaged app
//   clears `SIGNAL_CI_CONFIG` (app/config.main.ts), so it cannot be put in CI mode.
// An environment variable that is not cleared by a packaged app (`MOCK_TEST` is one) is not used.
export type LinkTestToolsWhereType = Readonly<{
  environment: Environment;
  ciMode: 'full' | 'benchmark' | false;
}>;

export function isLinkTestToolsEnabled({
  environment,
  ciMode,
}: LinkTestToolsWhereType): boolean {
  return environment !== Environment.PackagedApp || ciMode === 'full';
}
