// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import type { BuildUpgradeActionType } from '../util/buildExpiration.std.ts';
import type { WidthBreakpoint } from './_util.std.ts';

import { LeftPaneDialog } from './LeftPaneDialog.dom.tsx';
import { openLinkInWebBrowser } from '../util/openLinkInWebBrowser.dom.ts';

export type PropsType = {
  containerWidthBreakpoint: WidthBreakpoint;
  i18n: LocalizerType;
  isMAS: boolean;
  // Tellomi（#1269）：同 DialogExpiringBuild——smart 层按更新器状态给（getBuildUpgradeAction）；不给 = 上游行为。
  upgradeAction?: BuildUpgradeActionType;
  startUpdate?: () => void;
};

const WEBSITE_URL = 'https://tellomi.app/download/';
const APP_STORE_URL =
  'https://apps.apple.com/app/signal-private-messenger/id1230208093';

export function DialogExpiredBuild({
  containerWidthBreakpoint,
  i18n,
  isMAS,
  upgradeAction,
  startUpdate,
}: PropsType): JSX.Element | null {
  // Tellomi（#1269）：更新正在下载，下面的更新提示有进度条，这里只留文字。
  if (upgradeAction === 'none') {
    return (
      <LeftPaneDialog
        containerWidthBreakpoint={containerWidthBreakpoint}
        type="error"
      >
        {i18n('icu:expiredWarning')}{' '}
      </LeftPaneDialog>
    );
  }
  // Tellomi（#1269）：更新器手上有能下载 / 安装 / 重试的版本时，按钮做的和更新提示的按钮一样（startUpdate），
  // 不再让人去网页重新下载安装；其余情况照上游打开下载页。
  if (upgradeAction === 'updater' && startUpdate) {
    return (
      <LeftPaneDialog
        containerWidthBreakpoint={containerWidthBreakpoint}
        type="error"
        onClick={startUpdate}
        clickLabel={i18n('icu:BuildExpiration__update--tellomi')}
        hasAction
      >
        {i18n('icu:expiredWarning')}{' '}
      </LeftPaneDialog>
    );
  }
  return (
    <LeftPaneDialog
      containerWidthBreakpoint={containerWidthBreakpoint}
      type="error"
      onClick={() => {
        openLinkInWebBrowser(isMAS ? APP_STORE_URL : WEBSITE_URL);
      }}
      clickLabel={
        isMAS
          ? i18n('icu:DialogExpiredBuild__upgrade-mas')
          : i18n('icu:upgrade')
      }
      hasAction
    >
      {i18n('icu:expiredWarning')}{' '}
    </LeftPaneDialog>
  );
}
