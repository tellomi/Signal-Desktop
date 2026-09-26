// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import type { PropsType } from './DialogExpiringBuild.dom.tsx';
import { DialogExpiringBuild } from './DialogExpiringBuild.dom.tsx';
import { WidthBreakpoint } from './_util.std.ts';
import { FakeLeftPaneContainer } from '../test-helpers/FakeLeftPaneContainer.dom.tsx';

const { i18n } = window.SignalContext;

export default {
  title: 'Components/DialogExpiringBuild',
  argTypes: {},
  args: {},
} satisfies Meta<PropsType>;

export function FourteenDaysLeft(): JSX.Element {
  const containerWidthBreakpoint = WidthBreakpoint.Wide;

  return (
    <FakeLeftPaneContainer containerWidthBreakpoint={containerWidthBreakpoint}>
      <DialogExpiringBuild
        containerWidthBreakpoint={containerWidthBreakpoint}
        i18n={i18n}
        days={14}
      />
    </FakeLeftPaneContainer>
  );
}

export function LastDay(): JSX.Element {
  const containerWidthBreakpoint = WidthBreakpoint.Wide;

  return (
    <FakeLeftPaneContainer containerWidthBreakpoint={containerWidthBreakpoint}>
      <DialogExpiringBuild
        containerWidthBreakpoint={containerWidthBreakpoint}
        i18n={i18n}
        days={1}
      />
    </FakeLeftPaneContainer>
  );
}

// Tellomi（#1269）：更新器手上有能装的版本时，按钮走 startUpdate（同更新提示的按钮）。
export function UpdateReady(): JSX.Element {
  const containerWidthBreakpoint = WidthBreakpoint.Wide;

  return (
    <FakeLeftPaneContainer containerWidthBreakpoint={containerWidthBreakpoint}>
      <DialogExpiringBuild
        containerWidthBreakpoint={containerWidthBreakpoint}
        i18n={i18n}
        days={3}
        upgradeAction="updater"
        startUpdate={action('startUpdate')}
      />
    </FakeLeftPaneContainer>
  );
}

// Tellomi（#1269）：更新正在下载（下面的更新提示有进度条），这里不放按钮。
export function UpdateDownloading(): JSX.Element {
  const containerWidthBreakpoint = WidthBreakpoint.Wide;

  return (
    <FakeLeftPaneContainer containerWidthBreakpoint={containerWidthBreakpoint}>
      <DialogExpiringBuild
        containerWidthBreakpoint={containerWidthBreakpoint}
        i18n={i18n}
        days={3}
        upgradeAction="none"
      />
    </FakeLeftPaneContainer>
  );
}
