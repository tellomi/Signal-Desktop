// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

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
