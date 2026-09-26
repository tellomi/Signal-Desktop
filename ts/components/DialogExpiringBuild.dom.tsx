// Copyright 2026 重庆半格智能科技有限公司
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
  days: number;
  // Tellomi（#1269）：按钮走 App 自己的更新器还是打开下载页，smart 层按更新器状态给（getBuildUpgradeAction），
  // 'updater' 时一并给 startUpdate；不给 = 打开下载页。
  upgradeAction?: BuildUpgradeActionType;
  startUpdate?: () => void;
};

const WEBSITE_URL = 'https://tellomi.app/download/';

// Tellomi (tellomi/tellomi#1269, spec #1143 §3.6): a build expires 180 days after it was made, and then Desktop goes
// read-only (DialogExpiredBuild). Warn during the last 14 days so it doesn't come as a surprise, like Android's
// OutdatedBuildBanner and iOS's ExpirationNagView; upstream Desktop has no such warning.
export function DialogExpiringBuild({
  containerWidthBreakpoint,
  i18n,
  days,
  upgradeAction,
  startUpdate,
}: PropsType): JSX.Element {
  const body = i18n('icu:DialogExpiringBuild__body--tellomi', { days });

  // Tellomi（#1269）：更新正在下载，下面的更新提示有进度条，这里只留文字。
  if (upgradeAction === 'none') {
    return (
      <LeftPaneDialog
        containerWidthBreakpoint={containerWidthBreakpoint}
        type="warning"
      >
        {body}
      </LeftPaneDialog>
    );
  }

  const onUpdate = upgradeAction === 'updater' ? startUpdate : undefined;

  return (
    <LeftPaneDialog
      containerWidthBreakpoint={containerWidthBreakpoint}
      type="warning"
      onClick={
        onUpdate ??
        (() => {
          openLinkInWebBrowser(WEBSITE_URL);
        })
      }
      clickLabel={
        onUpdate
          ? i18n('icu:BuildExpiration__update--tellomi')
          : i18n('icu:upgrade')
      }
      hasAction
    >
      {body}
    </LeftPaneDialog>
  );
}
