// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { AxoButton } from '../../axo/AxoButton.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

export type PropsType = Readonly<{
  i18n: LocalizerType;
  // undefined：更新已经在下载（左栏的更新提示有进度），不画按钮。
  onUpdate: (() => void) | undefined;
}>;

// Tellomi（tellomi/tellomi#1399，需求 app-update-and-version-policy.md §3.4「只读模式」）：更新之前只读——服务端拒绝了这个版本（499）、
// 更新清单判了必须、或者本机构建到期。会话输入框换成这一行（同安卓 DisabledInputView 的「此版本需要更新才能收发消息。」），
// 不再让人照常打字、发出去全标「未送达」。
export function TellomiComposerUpdateRequired({
  i18n,
  onUpdate,
}: PropsType): JSX.Element {
  return (
    <div
      className={tw(
        'flex flex-col items-center gap-3 border-t border-primary p-4 text-center'
      )}
      data-testid="CompositionArea--tellomi-update-required"
    >
      <p className={tw('type-body-medium text-secondary')}>
        {i18n('icu:TellomiUpdateRequired__input_needs_update')}
      </p>
      {onUpdate ? (
        <AxoButton.Root variant="strong-primary" size="md" onClick={onUpdate}>
          {i18n('icu:TellomiUpdate__update_now')}
        </AxoButton.Root>
      ) : null}
    </div>
  );
}
