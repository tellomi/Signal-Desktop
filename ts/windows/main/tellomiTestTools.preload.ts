// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge } from 'electron';

import { createLinkTestTools } from '../../linkPreviews/linkTestTools.preload.ts';

// Tellomi (ADR-0063 §8.1 row 2): the tools for testing link previews, where they exist (see
// linkTestToolsGate.std.ts). They are in the window's own world, where `window.reduxStore`,
// `window.ConversationController` and `window.SignalContext` are, and in the page's main world,
// where `window.SignalDebug` and `window.SignalCI` are (Playwright evaluates there). In a packaged
// app `createLinkTestTools` gives nothing and nothing is put anywhere.
const tools = createLinkTestTools();
if (tools) {
  window.TellomiTestTools = tools;
  contextBridge.exposeInMainWorld('TellomiTestTools', tools);
}
