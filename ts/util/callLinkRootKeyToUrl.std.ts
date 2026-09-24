// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export function callLinkRootKeyToUrl(rootKey: string): string | undefined {
  if (!rootKey) {
    return;
  }

  // Tellomi: no slash before `#` — `https://tell.cc/call/` is a 404 on the landing site and released Android builds
  // only recognise `/call#` (see linkCallRoute in signalRoutes.std.ts, which still accepts both).
  return `https://tell.cc/call#key=${rootKey}`;
}
