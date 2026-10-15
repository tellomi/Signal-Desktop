// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { useId, useState } from 'react';
import type { JSX } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { Button, ButtonVariant } from './Button.dom.tsx';
import { Modal } from './Modal.dom.tsx';
import { TitlebarDragArea } from './TitlebarDragArea.dom.tsx';
import type { LocalizerType } from '../types/Util.std.ts';
import type {
  RequiredReason,
  UpdateRequiredButtonState,
} from '../util/tellomiUpdateManifest.std.ts';

// Tellomi（tellomi/tellomi#1399 Desktop 半边，需求 app-update-and-version-policy.md §3.4「必须更新（阻断页）」）：
// 盖满整个窗口的更新页。Tellomi 图标 → 「需要更新 Tellomi」→ 按 requiredReason 的一句原因 → 「更新不会影响电脑上的聊天记录」
// → 「新版本 x.y.z」→ 主按钮 → 「了解更新内容」→ 「暂不更新，只看聊天记录」。没有 ✕、Esc 不关；唯一的出口是最后一项，
// 先确认（「更新之前可以看聊天记录，但不能收发消息」）；从没关联过的电脑上没有聊天记录可看，不给这个出口（canViewChatsOnly），
// 只读还会挡住关联用的二维码连接，给了只会落到「连接服务器失败」。主按钮跟着自更新器走（需求「Desktop：后台下载完成后按钮变『重启并更新』」）：
// 状态由 util/tellomiUpdateManifest 的 requiredButtonState 从 redux updates 算：'update' = 立即更新、'downloading' = 下载中 x%
// （不能点）、'restart' = 重启并更新。
// 文案和安卓的 TellomiUpdateRequired 一致（「手机」换成「电脑」）。

export type PropsType = Readonly<{
  i18n: LocalizerType;
  version: string;
  reason: RequiredReason;
  notesUrl?: string;
  button: UpdateRequiredButtonState;
  canViewChatsOnly: boolean;
  onUpdate: () => void;
  onOpenNotes: (url: string) => void;
  onViewChatsOnly: () => void;
}>;

function reasonText(i18n: LocalizerType, reason: RequiredReason): string {
  switch (reason) {
    case 'security':
      return i18n('icu:TellomiUpdateRequired__reason_security');
    case 'protocol':
      return i18n('icu:TellomiUpdateRequired__reason_protocol');
    default:
      return i18n('icu:TellomiUpdateRequired__reason_other');
  }
}

function buttonText(
  i18n: LocalizerType,
  button: UpdateRequiredButtonState
): string {
  switch (button.kind) {
    case 'restart':
      return i18n('icu:TellomiUpdateRequired__restart');
    case 'downloading':
      return button.percent === undefined
        ? i18n('icu:TellomiUpdateRequired__downloading_unknown')
        : i18n('icu:TellomiUpdateRequired__downloading', {
            percent: String(button.percent),
          });
    default:
      return i18n('icu:TellomiUpdate__update_now');
  }
}

export function TellomiUpdateRequired({
  i18n,
  version,
  reason,
  notesUrl,
  button,
  canViewChatsOnly,
  onUpdate,
  onOpenNotes,
  onViewChatsOnly,
}: PropsType): JSX.Element {
  const titleId = useId();
  const [isConfirming, setIsConfirming] = useState(false);

  const linkClassName = tw(
    'type-body-large text-accent hover:underline',
    'rounded-xs outline-none keyboard-mode:focus:axo-focus-ring'
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={tw('flex size-full flex-col bg-surface-primary text-primary')}
    >
      <TitlebarDragArea />
      <div
        className={tw(
          'flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-10'
        )}
      >
        <div className={tw('flex max-w-[440px] flex-col items-center')}>
          <div className="module-splash-screen__logo module-splash-screen__logo--96" />
          <h1 id={titleId} className={tw('text-center type-title-large')}>
            {i18n('icu:TellomiUpdateRequired__title')}
          </h1>
          <p className={tw('mt-3 text-center type-body-large')}>
            {reasonText(i18n, reason)}
          </p>
          <p className={tw('mt-2 text-center type-body-medium text-secondary')}>
            {i18n('icu:TellomiUpdate__available_body')}
          </p>
          <p className={tw('mt-4 text-center type-body-medium text-secondary')}>
            {i18n('icu:TellomiUpdateRequired__new_version', { version })}
          </p>
          <div className={tw('mt-6 flex w-full flex-col items-center gap-4')}>
            <AxoButton.Root
              variant="strong-primary"
              size="lg"
              width="full"
              disabled={button.kind === 'downloading'}
              onClick={onUpdate}
            >
              {buttonText(i18n, button)}
            </AxoButton.Root>
            {notesUrl ? (
              <button
                type="button"
                className={linkClassName}
                onClick={() => onOpenNotes(notesUrl)}
              >
                {i18n('icu:TellomiUpdate__learn_more')}
              </button>
            ) : null}
            {canViewChatsOnly ? (
              <button
                type="button"
                className={tw(
                  'type-body-medium text-secondary hover:underline',
                  'rounded-xs outline-none keyboard-mode:focus:axo-focus-ring'
                )}
                onClick={() => setIsConfirming(true)}
              >
                {i18n('icu:TellomiUpdateRequired__view_chats_only')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {isConfirming ? (
        <Modal
          modalName="TellomiUpdateRequiredViewChatsOnly"
          i18n={i18n}
          onClose={() => setIsConfirming(false)}
          onTopOfEverything
          modalFooter={
            <>
              <Button
                variant={ButtonVariant.Secondary}
                onClick={() => setIsConfirming(false)}
              >
                {i18n('icu:cancel')}
              </Button>
              <Button
                variant={ButtonVariant.Primary}
                onClick={() => {
                  setIsConfirming(false);
                  onViewChatsOnly();
                }}
              >
                {i18n('icu:TellomiUpdateRequired__view_chats_only_confirm')}
              </Button>
            </>
          }
        >
          <p className={tw('type-body-large text-primary')}>
            {i18n('icu:TellomiUpdateRequired__view_chats_only_confirm_message')}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
