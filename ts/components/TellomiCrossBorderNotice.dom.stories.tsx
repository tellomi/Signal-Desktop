// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import type { PropsType } from './TellomiCrossBorderNotice.dom.tsx';
import { TellomiCrossBorderNotice } from './TellomiCrossBorderNotice.dom.tsx';

const { i18n } = window.SignalContext;

// Tellomi（tellomi/tellomi#1338）：Desktop 启动 / 重新关联前整窗显示的跨境告知（只读版）
export default {
  title: 'Components/TellomiCrossBorderNotice',
  argTypes: {},
  args: {},
} satisfies Meta<PropsType>;

export function Default(): JSX.Element {
  return (
    <div style={{ height: '100vh' }}>
      <TellomiCrossBorderNotice
        i18n={i18n}
        onAcknowledge={action('onAcknowledge')}
      />
    </div>
  );
}
