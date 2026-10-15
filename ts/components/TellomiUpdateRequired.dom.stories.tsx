// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';
import type { ComponentMeta } from '../storybook/types.std.ts';
import type { PropsType } from './TellomiUpdateRequired.dom.tsx';
import { TellomiUpdateRequired } from './TellomiUpdateRequired.dom.tsx';

const { i18n } = window.SignalContext;

export default {
  title: 'Components/TellomiUpdateRequired',
  component: TellomiUpdateRequired,
  args: {
    i18n,
    version: '0.1.13',
    reason: 'security',
    notesUrl: 'https://www.tellomi.app/changelog/#desktop',
    button: { kind: 'update' },
    canViewChatsOnly: true,
    onUpdate: action('onUpdate'),
    onOpenNotes: action('onOpenNotes'),
    onViewChatsOnly: action('onViewChatsOnly'),
  },
} satisfies ComponentMeta<PropsType>;

export function Security(args: PropsType): JSX.Element {
  return <TellomiUpdateRequired {...args} />;
}

export function Protocol(args: PropsType): JSX.Element {
  return <TellomiUpdateRequired {...args} reason="protocol" />;
}

export function OtherWithoutNotes(args: PropsType): JSX.Element {
  return (
    <TellomiUpdateRequired {...args} reason="other" notesUrl={undefined} />
  );
}

export function Downloading(args: PropsType): JSX.Element {
  return (
    <TellomiUpdateRequired
      {...args}
      button={{ kind: 'downloading', percent: 42 }}
    />
  );
}

export function Downloaded(args: PropsType): JSX.Element {
  return <TellomiUpdateRequired {...args} button={{ kind: 'restart' }} />;
}

export function NeverLinked(args: PropsType): JSX.Element {
  return <TellomiUpdateRequired {...args} canViewChatsOnly={false} />;
}
