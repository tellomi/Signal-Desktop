// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';

import { About } from '../../components/About.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

// The About window runs with contextIsolation: window.SignalContext.i18n reaches the page through the context
// bridge, which copies a function but not the properties set on it, so `i18n.getIntl` is gone there.
// <I18n> needs getIntl(), and using it in About made the real window render nothing (found on a real Electron
// 43.5 run, 2026-09-30, tellomi/tellomi#1421). Storybook has no bridge, so only a test with a bare function can see it.
describe('<About /> under contextIsolation (tellomi/tellomi#1400)', () => {
  // A bare function, exactly what the page gets: no getIntl, no getLocale, nothing else.
  const bridgedI18n = Object.assign(
    (key: string, values?: Record<string, string>) => {
      if (key === 'icu:About__SourceCode') {
        return `BEFORE ${values?.sourceLink} AFTER`;
      }
      return `[${key}]`;
    }
  ) as unknown as LocalizerType;

  function render(): string {
    return renderToStaticMarkup(
      <About
        closeAbout={() => null}
        appEnv="development"
        arch="arm64"
        platform="darwin"
        i18n={bridgedI18n}
        version="0.0.0"
        copyText={async () => undefined}
      />
    );
  }

  it('renders with an i18n that has no getIntl', () => {
    assert.doesNotThrow(render);
  });

  it('puts the source link inside the licence sentence', () => {
    const html = render();
    assert.match(
      html,
      /BEFORE <a class="source" href="https:\/\/www\.tellomi\.app\/source">www\.tellomi\.app\/source<\/a> AFTER/
    );
  });
});
