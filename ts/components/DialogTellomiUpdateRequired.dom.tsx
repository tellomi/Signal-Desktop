// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import type { WidthBreakpoint } from './_util.std.ts';

import { LeftPaneDialog } from './LeftPaneDialog.dom.tsx';

export type PropsType = {
  containerWidthBreakpoint: WidthBreakpoint;
  i18n: LocalizerType;
  onShowUpdateRequired: () => void;
};

// Tellomi (tellomi/tellomi#1399, spec app-update-and-version-policy.md §3.4): the update manifest requires an update,
// so this version is read-only (chats can be viewed, nothing is sent or received). This red banner stays above the
// chat list until the update or until the manifest withdraws the requirement; clicking it opens the update-required
// page again. Same wording as Android's read-only banner.
export function DialogTellomiUpdateRequired({
  containerWidthBreakpoint,
  i18n,
  onShowUpdateRequired,
}: PropsType): JSX.Element {
  return (
    <LeftPaneDialog
      containerWidthBreakpoint={containerWidthBreakpoint}
      type="error"
      onClick={onShowUpdateRequired}
      clickLabel={i18n('icu:BuildExpiration__update--tellomi')}
      hasAction
    >
      {i18n('icu:TellomiUpdateRequired__read_only_banner')}
    </LeftPaneDialog>
  );
}
