// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { Button, ButtonVariant } from './Button.dom.tsx';
import { Modal } from './Modal.dom.tsx';
import type { LocalizerType } from '../types/Util.std.ts';

// Tellomi（tellomi/tellomi#1399 Desktop 半边，需求 app-update-and-version-policy.md §3.4「推荐更新」）：
// 推荐档进首页后弹一次的卡片——「发现新版本 x.y.z」· 一句说明 ·「了解更新内容」·「以后再说」/「立即更新」。
// 同一版本只弹一次（服务在 services/tellomiUpdateTier 里记）。文案和安卓 / iOS 的 TellomiUpdateAvailable 一致（「手机」换成「电脑」）。

export type PropsType = Readonly<{
  i18n: LocalizerType;
  version: string;
  notesUrl?: string;
  onUpdate: () => void;
  onLater: () => void;
  onOpenNotes: (url: string) => void;
}>;

export function TellomiUpdateAvailableDialog({
  i18n,
  version,
  notesUrl,
  onUpdate,
  onLater,
  onOpenNotes,
}: PropsType): JSX.Element {
  return (
    <Modal
      modalName="TellomiUpdateAvailableDialog"
      i18n={i18n}
      title={i18n('icu:TellomiUpdate__available_title', { version })}
      onClose={onLater}
      modalFooter={
        <>
          <Button variant={ButtonVariant.Secondary} onClick={onLater}>
            {i18n('icu:TellomiUpdate__later')}
          </Button>
          <Button variant={ButtonVariant.Primary} onClick={onUpdate}>
            {i18n('icu:TellomiUpdate__update_now')}
          </Button>
        </>
      }
    >
      <div className={tw('flex flex-col items-start gap-3')}>
        <p className={tw('type-body-large text-primary')}>
          {i18n('icu:TellomiUpdate__available_body')}
        </p>
        {notesUrl ? (
          <button
            type="button"
            className={tw(
              'type-body-large text-accent hover:underline',
              'rounded-xs outline-none keyboard-mode:focus:axo-focus-ring'
            )}
            onClick={() => onOpenNotes(notesUrl)}
          >
            {i18n('icu:TellomiUpdate__learn_more')}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
