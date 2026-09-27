// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createRoot } from 'react-dom/client';

import { tw } from '../axo/tw.dom.tsx';
import { TellomiCrossBorderNotice } from '../components/TellomiCrossBorderNotice.dom.tsx';
import { AppProvider } from '../windows/AppProvider.dom.tsx';

// Tellomi（tellomi/tellomi#1338）：把跨境告知（只读版）盖满整个窗口，点「知道了」后卸掉并 resolve。
// 不依赖 redux：启动时它出现在 itemStorage 就绪之后、redux 和 App 根节点建起来之前（盖住加载页）；
// 重新关联时它盖在已渲染的 App 上面，这时把 #app-container 设成 inert，键盘焦点进不到后面去。
export function showTellomiCrossBorderNotice(): Promise<void> {
  const { i18n } = window.SignalContext;

  return new Promise(resolve => {
    const container = document.createElement('div');
    container.className = tw(
      'fixed inset-0 legacy-z-index-on-top-of-everything'
    );
    document.body.appendChild(container);

    const appContainer = document.getElementById('app-container');
    appContainer?.setAttribute('inert', '');

    const root = createRoot(container);
    const onAcknowledge = () => {
      root.unmount();
      container.remove();
      appContainer?.removeAttribute('inert');
      resolve();
    };

    root.render(
      <AppProvider>
        <TellomiCrossBorderNotice i18n={i18n} onAcknowledge={onAcknowledge} />
      </AppProvider>
    );
  });
}
