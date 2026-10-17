// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { WidthBreakpoint } from './_util.std.ts';

import { LeftPaneDialog } from './LeftPaneDialog.dom.tsx';

export type PropsType = {
  containerWidthBreakpoint: WidthBreakpoint;
  // 两句都已经按语言和截止时间拼好（smart/LeftPane）
  body: string;
  appeal: string;
};

// Tellomi（tellomi/tellomi ADR-0078 §3.4）：账号被人工处置时，聊天列表顶上说明为什么发不出去、到什么时候、去哪申诉。
// 不能关：截止时间到了或者服务端说没有了就自动消失。文字可以选中复制（申诉邮箱、处置编号）。
export function DialogTellomiRestriction({
  containerWidthBreakpoint,
  body,
  appeal,
}: PropsType): JSX.Element {
  return (
    <LeftPaneDialog
      containerWidthBreakpoint={containerWidthBreakpoint}
      type="warning"
      icon="warning"
      hoverText={`${body} ${appeal}`}
    >
      <span className="DialogTellomiRestriction__text">
        {body} {appeal}
      </span>
    </LeftPaneDialog>
  );
}
