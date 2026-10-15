// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';
import type { ComponentMeta } from '../storybook/types.std.ts';
import type { PropsType } from './TellomiUpdateAvailableDialog.dom.tsx';
import { TellomiUpdateAvailableDialog } from './TellomiUpdateAvailableDialog.dom.tsx';

const { i18n } = window.SignalContext;

export default {
  title: 'Components/TellomiUpdateAvailableDialog',
  component: TellomiUpdateAvailableDialog,
  args: {
    i18n,
    version: '0.1.13',
    notesUrl: 'https://www.tellomi.app/changelog/#desktop',
    onUpdate: action('onUpdate'),
    onLater: action('onLater'),
    onOpenNotes: action('onOpenNotes'),
  },
} satisfies ComponentMeta<PropsType>;

export function Default(args: PropsType): JSX.Element {
  return <TellomiUpdateAvailableDialog {...args} />;
}

export function WithoutNotes(args: PropsType): JSX.Element {
  return <TellomiUpdateAvailableDialog {...args} notesUrl={undefined} />;
}
