// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createRoot } from 'react-dom/client';

import { TellomiUpdateAvailableDialog } from '../components/TellomiUpdateAvailableDialog.dom.tsx';
import { openLinkInWebBrowser } from '../util/openLinkInWebBrowser.dom.ts';
import { AppProvider } from '../windows/AppProvider.dom.tsx';

export type UpdateAvailableChoice = 'update' | 'later';

// Tellomi（tellomi/tellomi#1399）：推荐档的卡片（同 showTellomiCrossBorderNotice 的做法，不依赖 redux）：
// 渲染一个现有的 Modal，选了「立即更新」或「以后再说」（含点外面、Esc）就卸掉并 resolve。不挡住 App（不设 inert）。
export function showTellomiUpdateAvailable(options: {
  version: string;
  notesUrl?: string;
}): Promise<UpdateAvailableChoice> {
  const { i18n } = window.SignalContext;

  return new Promise(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const finish = (choice: UpdateAvailableChoice) => {
      root.unmount();
      container.remove();
      resolve(choice);
    };

    root.render(
      <AppProvider>
        <TellomiUpdateAvailableDialog
          i18n={i18n}
          version={options.version}
          notesUrl={options.notesUrl}
          onUpdate={() => finish('update')}
          onLater={() => finish('later')}
          onOpenNotes={url => openLinkInWebBrowser(url)}
        />
      </AppProvider>
    );
  });
}
