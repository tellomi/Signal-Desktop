// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import type { PropsType } from './TellomiCrossBorderNotice.dom.tsx';
import {
  TellomiCrossBorderFullNotice,
  TellomiCrossBorderNotice,
} from './TellomiCrossBorderNotice.dom.tsx';

const { i18n } = window.SignalContext;

// Tellomi（tellomi/tellomi#1338）：Desktop 启动 / 重新关联前的跨境告知弹窗（需求说明 6.6，关联设备版）和点开的全文页
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

export function FullNotice(): JSX.Element {
  return (
    <div style={{ height: '100vh' }}>
      <TellomiCrossBorderFullNotice i18n={i18n} onClose={action('onClose')} />
    </div>
  );
}
