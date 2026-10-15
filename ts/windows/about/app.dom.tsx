// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

import '../sandboxedInit.dom.ts';
import { About } from '../../components/About.dom.tsx';
import { strictAssert } from '../../util/assert.std.ts';
import { drop } from '../../util/drop.std.ts';
import { AppProvider } from '../AppProvider.dom.tsx';
import { setDocumentLocale } from '../../util/setDocumentLocale.dom.ts';

const { AboutWindowProps } = window.Signal;
const { i18n } = window.SignalContext;

setDocumentLocale(document);

strictAssert(AboutWindowProps, 'window values not provided');

const app = document.getElementById('app');
strictAssert(app != null, 'No #app');

// Tellomi (tellomi/tellomi#1399): ask the main process once whether the update manifest knows a newer version.
function AboutWithUpdateTier(): JSX.Element {
  const [newVersion, setNewVersion] = useState<
    { version: string; notesUrl?: string } | undefined
  >(undefined);
  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const state = await AboutWindowProps?.getUpdateTier();
        if (state && state.tier !== 'none' && state.latestVersion) {
          setNewVersion({
            version: state.latestVersion,
            notesUrl: state.notesUrl,
          });
        }
      } catch {
        // The main process is not running the update manifest (tests, development).
      }
    }
    drop(load());
  }, []);

  return (
    <About
      closeAbout={() => window.SignalContext.executeMenuRole('close')}
      appEnv={AboutWindowProps?.appEnv ?? ''}
      platform={AboutWindowProps?.platform ?? ''}
      arch={AboutWindowProps?.arch ?? ''}
      i18n={i18n}
      version={window.SignalContext.getVersion()}
      copyText={text => navigator.clipboard.writeText(text)}
      newVersion={newVersion}
    />
  );
}

createRoot(app).render(
  <AppProvider>
    <AboutWithUpdateTier />
  </AppProvider>
);
