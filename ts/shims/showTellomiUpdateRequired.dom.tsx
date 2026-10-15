// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createRoot } from 'react-dom/client';

import { tw } from '../axo/tw.dom.tsx';
import { TellomiUpdateRequired } from '../components/TellomiUpdateRequired.dom.tsx';
import type { PropsType as TellomiUpdateRequiredPropsType } from '../components/TellomiUpdateRequired.dom.tsx';
import { AppProvider } from '../windows/AppProvider.dom.tsx';

export type UpdateRequiredLayerProps = Omit<
  TellomiUpdateRequiredPropsType,
  'i18n'
>;

export type UpdateRequiredLayer = Readonly<{
  render: (props: UpdateRequiredLayerProps) => void;
  close: () => void;
}>;

// Tellomi（tellomi/tellomi#1399）：必须档的阻断页（同 showTellomiCrossBorderNotice 的做法，不依赖 redux）：一层盖满整个窗口，
// #app-container 设成 inert，键盘焦点进不到后面去。不自己关——服务（services/tellomiUpdateTier）在用户选了只读或清单撤销时 close；
// 主按钮的状态会变（下载进度），服务每次变了就 render 一次新的 props。
export function openTellomiUpdateRequired(
  initialProps: UpdateRequiredLayerProps
): UpdateRequiredLayer {
  const { i18n } = window.SignalContext;

  const container = document.createElement('div');
  container.className = tw('fixed inset-0 legacy-z-index-on-top-of-everything');
  document.body.appendChild(container);

  const appContainer = document.getElementById('app-container');
  appContainer?.setAttribute('inert', '');

  const root = createRoot(container);
  const render = (props: UpdateRequiredLayerProps) => {
    root.render(
      <AppProvider>
        <TellomiUpdateRequired i18n={i18n} {...props} />
      </AppProvider>
    );
  };
  render(initialProps);

  let isClosed = false;
  return {
    render: props => {
      if (!isClosed) {
        render(props);
      }
    },
    close: () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      root.unmount();
      container.remove();
      appContainer?.removeAttribute('inert');
    },
  };
}
