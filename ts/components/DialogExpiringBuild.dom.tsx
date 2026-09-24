// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import type { WidthBreakpoint } from './_util.std.ts';

import { LeftPaneDialog } from './LeftPaneDialog.dom.tsx';
import { openLinkInWebBrowser } from '../util/openLinkInWebBrowser.dom.ts';

export type PropsType = {
  containerWidthBreakpoint: WidthBreakpoint;
  i18n: LocalizerType;
  days: number;
};

const WEBSITE_URL = 'https://tellomi.app/download/';

// Tellomi (tellomi/tellomi#1269, spec #1143 §3.6): a build expires 180 days after it was made, and then Desktop goes
// read-only (DialogExpiredBuild). Warn during the last 14 days so it doesn't come as a surprise, like Android's
// OutdatedBuildBanner and iOS's ExpirationNagView; upstream Desktop has no such warning.
export function DialogExpiringBuild({
  containerWidthBreakpoint,
  i18n,
  days,
}: PropsType): JSX.Element {
  return (
    <LeftPaneDialog
      containerWidthBreakpoint={containerWidthBreakpoint}
      type="warning"
      onClick={() => {
        openLinkInWebBrowser(WEBSITE_URL);
      }}
      clickLabel={i18n('icu:upgrade')}
      hasAction
    >
      {i18n('icu:DialogExpiringBuild__body--tellomi', { days })}
    </LeftPaneDialog>
  );
}
