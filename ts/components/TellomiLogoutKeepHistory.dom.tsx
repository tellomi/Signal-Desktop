// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { MouseEvent, ReactNode } from 'react';
import { useState } from 'react';

import { AxoConfirmDialog } from '../axo/AxoConfirmDialog.dom.tsx';
import { AxoItem } from '../axo/items/AxoItem.dom.tsx';
import type { LocalizerType } from '../types/Util.std.ts';
import { drop } from '../util/drop.std.ts';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4）：设置 → 通用里和「删除应用数据」放在一起的
// 「退出登录（保留聊天记录）」。点按钮出确认弹窗；点「退出登录」后弹窗留着、按钮转圈，等服务器回话：
// 成功由上层把本机切到「未连接」，失败由上层提示「退出登录需要联网」；两种情况弹窗都关掉。
// 请求进行中不许取消（Esc / 「取消」），免得用户以为取消了、服务器那边却已经删了本机。

export type TellomiLogoutKeepHistoryItemProps = Readonly<{
  i18n: LocalizerType;
  onLogout: () => Promise<unknown>;
}>;

async function logoutThenClose(
  onLogout: () => Promise<unknown>,
  close: () => void
): Promise<void> {
  try {
    await onLogout();
  } finally {
    close();
  }
}

export function TellomiLogoutKeepHistoryItem({
  i18n,
  onLogout,
}: TellomiLogoutKeepHistoryItemProps): ReactNode {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (isPending) {
      return;
    }
    setIsConfirming(open);
  };

  const handleConfirm = (event: MouseEvent<HTMLButtonElement>) => {
    // AlertDialog.Action 点击后默认会关弹窗；先留着，等结果出来再关。
    event.preventDefault();
    if (isPending) {
      return;
    }
    setIsPending(true);
    drop(
      logoutThenClose(onLogout, () => {
        setIsPending(false);
        setIsConfirming(false);
      })
    );
  };

  return (
    <>
      <AxoItem.Root>
        <AxoItem.Content>
          <AxoItem.Body>
            <AxoItem.Label>
              {i18n('icu:Preferences__logout-keep-history--tellomi')}
            </AxoItem.Label>
            <AxoItem.Accessory>
              <AxoItem.Action
                variant="subtle-destructive"
                onClick={() => setIsConfirming(true)}
              >
                {i18n('icu:Preferences__logout-button--tellomi')}
              </AxoItem.Action>
            </AxoItem.Accessory>
          </AxoItem.Body>
        </AxoItem.Content>
      </AxoItem.Root>
      <AxoConfirmDialog.Root
        open={isConfirming}
        onOpenChange={handleOpenChange}
        title={i18n('icu:Preferences__logout-confirm-title--tellomi')}
        description={i18n('icu:Preferences__logout-confirm-body--tellomi')}
      >
        <AxoConfirmDialog.Cancel disabled={isPending} />
        <AxoConfirmDialog.Action
          variant="strong-destructive"
          pending={isPending}
          onClick={handleConfirm}
        >
          {i18n('icu:Preferences__logout-button--tellomi')}
        </AxoConfirmDialog.Action>
      </AxoConfirmDialog.Root>
    </>
  );
}
