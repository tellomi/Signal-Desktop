// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { linkCallRoute } from './signalRoutes.std.ts';

export function callLinkRootKeyToUrl(rootKey: string): string | undefined {
  if (!rootKey) {
    return;
  }

  // Tellomi: one place builds call links — linkCallRoute (no slash before `#`: `https://tell.cc/call/` is a 404 on the
  // landing site and released Android builds only recognise `/call#`). A second hand-written copy here drifted once.
  return linkCallRoute.toWebUrl({ key: rootKey }).toString();
}
