// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';

import { Environment } from '../../environment.std.ts';
import { createLinkTestTools } from '../../linkPreviews/linkTestTools.preload.ts';
import { isLinkTestToolsEnabled } from '../../linkPreviews/linkTestToolsGate.std.ts';

// ADR-0063 §8.1 row 2 ("测试发送工具") and the rule that goes with it: the tool exists only where
// the app is run from its sources, and in the end-to-end runs against the mock server. In an app
// that was packaged and handed out it is not there at all: `window.TellomiTestTools` is
// `undefined`, not an object that refuses.

const CI_MODES = ['full', 'benchmark', false] as const;

describe('where the tools for testing link previews exist', () => {
  describe('isLinkTestToolsEnabled', () => {
    it('is not enabled in a packaged app, whatever else is set', () => {
      for (const ciMode of [false, 'benchmark'] as const) {
        assert.isFalse(
          isLinkTestToolsEnabled({
            environment: Environment.PackagedApp,
            ciMode,
          }),
          `ciMode ${String(ciMode)}`
        );
      }
    });

    it('is enabled in the end-to-end runs, which start the app as a release in CI mode', () => {
      assert.isTrue(
        isLinkTestToolsEnabled({
          environment: Environment.PackagedApp,
          ciMode: 'full',
        })
      );
    });

    it('is enabled when the app is run from its sources', () => {
      for (const environment of [
        Environment.Development,
        Environment.Staging,
        Environment.Test,
      ]) {
        for (const ciMode of CI_MODES) {
          assert.isTrue(
            isLinkTestToolsEnabled({ environment, ciMode }),
            `${environment} ${String(ciMode)}`
          );
        }
      }
    });
  });

  describe('createLinkTestTools', () => {
    it('makes nothing in a packaged app: undefined, not an object that refuses', () => {
      for (const ciMode of [false, 'benchmark'] as const) {
        const tools = createLinkTestTools({
          environment: Environment.PackagedApp,
          ciMode,
        });
        assert.isUndefined(tools);
      }
    });

    it('makes the tool where it is enabled, and nothing else', () => {
      for (const where of [
        { environment: Environment.Development, ciMode: false },
        { environment: Environment.PackagedApp, ciMode: 'full' },
      ] as const) {
        const tools = createLinkTestTools(where);
        assert.isDefined(tools);
        assert.deepEqual(Object.keys(tools ?? {}), ['sendTestLinkPreview']);
        assert.isFunction(tools?.sendTestLinkPreview);
      }
    });

    it('refuses a target that is no conversation, without sending anything', async () => {
      const tools = createLinkTestTools({
        environment: Environment.Development,
        ciMode: false,
      });
      const window_ = window as unknown as Record<string, unknown>;
      const saved = window_.ConversationController;
      window_.ConversationController = { get: () => undefined };
      try {
        let error: unknown;
        try {
          await tools?.sendTestLinkPreview('nobody', {
            body: 'https://example.com/',
            preview: { url: 'https://example.com/' },
          });
        } catch (caught) {
          error = caught;
        }
        assert.instanceOf(error, Error);
        assert.include(error.message, 'no conversation');
      } finally {
        window_.ConversationController = saved;
      }
    });
  });

  // The window of the app puts the tools in place in one file, and only what `createLinkTestTools`
  // returns: this is what keeps a packaged app from having them (the files are in the bundle
  // either way). A source check, because that file runs in the window's preload, which these
  // tests cannot start; the end-to-end test starts a real app without the CI mode, in the
  // environment of a release, and looks for the object.
  describe('what the window does with them', () => {
    const ROOT = cwd();
    const source = readFileSync(
      join(ROOT, 'ts', 'windows', 'main', 'tellomiTestTools.preload.ts'),
      'utf8'
    );

    it('puts them in place only when they were made', () => {
      const [before, after] = source.split('if (tools) {');
      assert.isDefined(after, 'a check on what was made');
      assert.notInclude(before ?? '', 'exposeInMainWorld(');
      assert.notMatch(before ?? '', /window\.TellomiTestTools\s*=/);
      assert.include(
        after ?? '',
        "exposeInMainWorld('TellomiTestTools', tools)"
      );
    });

    it('is part of the main window', () => {
      const start = readFileSync(
        join(ROOT, 'ts', 'windows', 'main', 'start.preload.ts'),
        'utf8'
      );
      assert.include(start, "import './tellomiTestTools.preload.ts';");
    });
  });
});
