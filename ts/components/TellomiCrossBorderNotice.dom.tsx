// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { Button, ButtonVariant } from './Button.dom.tsx';
import { Modal } from './Modal.dom.tsx';
import { TitlebarDragArea } from './TitlebarDragArea.dom.tsx';
import type { LocalizerType } from '../types/Util.std.ts';
import {
  TELLOMI_PRIVACY_POLICY_URL,
  TELLOMI_THIRD_PARTY_LIST_URL,
} from '../util/tellomiCrossBorderNotice.std.ts';

// Tellomi（tellomi/tellomi#1338）：跨境告知的「关联设备」版（需求说明 6.6「三种弹窗」第三行）。
// Desktop 永远是关联设备：同意在手机上取得，这里只告知，没有「同意 / 不同意」，只有一个「知道了」。
// 空白遮罩（品牌底色）上一个现有的 Modal：DIALOG_TITLE · LINKED_DIALOG_BODY · 链接 DIALOG_FULL_NOTICE_LINK · 「知道了」；
// 首次打开 / 重新关联时关不掉（点外面、Esc 都不关）。点链接出全文页盖在弹窗上面，「返回」回到弹窗。
// 全文用本地字符串渲染；页面本身不发起任何网络请求，隐私政策 / 第三方清单两个链接由用户点了才交给系统浏览器
// （主进程 will-navigate / setWindowOpenHandler → shell.openExternal）。

export type PropsType = Readonly<{
  i18n: LocalizerType;
  onAcknowledge: () => void;
}>;

export function TellomiCrossBorderNotice({
  i18n,
  onAcknowledge,
}: PropsType): JSX.Element {
  const [isFullNoticeOpen, setIsFullNoticeOpen] = useState(false);

  return (
    <div className={tw('size-full bg-surface-primary')}>
      <TitlebarDragArea />
      {isFullNoticeOpen ? (
        <TellomiCrossBorderFullNotice
          i18n={i18n}
          onClose={() => setIsFullNoticeOpen(false)}
        />
      ) : (
        <Modal
          modalName="TellomiCrossBorderNoticeDialog"
          i18n={i18n}
          title={i18n('icu:TellomiCrossBorder__dialog_title')}
          noEscapeClose
          noMouseClose
          onTopOfEverything
          modalFooter={
            <Button variant={ButtonVariant.Primary} onClick={onAcknowledge}>
              {i18n('icu:TellomiCrossBorder__linked_ack')}
            </Button>
          }
        >
          <TellomiCrossBorderNoticeDialogBody
            i18n={i18n}
            onOpenFullNotice={() => setIsFullNoticeOpen(true)}
          />
        </Modal>
      )}
    </div>
  );
}

export type DialogBodyPropsType = Readonly<{
  i18n: LocalizerType;
  onOpenFullNotice: () => void;
}>;

// 弹窗正文就两行：LINKED_DIALOG_BODY + 打开全文的链接（没有 9 项全文）
export function TellomiCrossBorderNoticeDialogBody({
  i18n,
  onOpenFullNotice,
}: DialogBodyPropsType): JSX.Element {
  return (
    <div className={tw('flex flex-col items-start gap-3')}>
      <p className={tw('type-body-large text-primary')}>
        {i18n('icu:TellomiCrossBorder__linked_dialog_body')}
      </p>
      <button
        type="button"
        className={tw(
          'type-body-large text-accent hover:underline',
          'rounded-xs outline-none keyboard-mode:focus:axo-focus-ring'
        )}
        onClick={onOpenFullNotice}
      >
        {i18n('icu:TellomiCrossBorder__dialog_full_notice_link')}
      </button>
    </div>
  );
}

export type FullNoticePropsType = Readonly<{
  i18n: LocalizerType;
  onClose: () => void;
}>;

// 全文页：FULL_NOTICE_TITLE · 9 项（第 9 项正文用 LINKED_ITEM_CONSENT_BODY）· 两个链接 · 「返回」
export function TellomiCrossBorderFullNotice({
  i18n,
  onClose,
}: FullNoticePropsType): JSX.Element {
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 让键盘（方向键 / 空格 / PageDown）直接能滚动正文
  useEffect(() => {
    scrollRef.current?.focus();
  }, []);

  // 9 项的顺序固定：是否出境 → 境外接收方 → 联系方式 → 处理目的 → 处理方式 → 个人信息种类 → 您的权利 → 法定程序 → 单独同意
  const items: ReadonlyArray<Readonly<{ title: string; body: string }>> = [
    {
      title: i18n('icu:TellomiCrossBorder__item_where_title'),
      body: i18n('icu:TellomiCrossBorder__item_where_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_recipients_title'),
      body: i18n('icu:TellomiCrossBorder__item_recipients_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_contact_title'),
      body: i18n('icu:TellomiCrossBorder__item_contact_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_purpose_title'),
      body: i18n('icu:TellomiCrossBorder__item_purpose_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_method_title'),
      body: i18n('icu:TellomiCrossBorder__item_method_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_kinds_title'),
      body: i18n('icu:TellomiCrossBorder__item_kinds_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_rights_title'),
      body: i18n('icu:TellomiCrossBorder__item_rights_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_procedure_title'),
      body: i18n('icu:TellomiCrossBorder__item_procedure_body'),
    },
    {
      title: i18n('icu:TellomiCrossBorder__item_consent_title'),
      body: i18n('icu:TellomiCrossBorder__linked_item_consent_body'),
    },
  ];

  const linkClassName = tw(
    'type-body-large text-accent underline-offset-2 hover:underline',
    'rounded-xs outline-none keyboard-mode:focus:axo-focus-ring'
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={tw('flex size-full flex-col bg-surface-primary text-primary')}
    >
      <div
        ref={scrollRef}
        tabIndex={-1}
        className={tw('min-h-0 flex-1 overflow-y-auto outline-none')}
      >
        <div
          className={tw(
            'mx-auto max-w-[600px] px-8 pb-8',
            'pt-[calc(var(--title-bar-drag-area-height)+40px)]'
          )}
        >
          <h1 id={titleId} className={tw('type-title-large')}>
            {i18n('icu:TellomiCrossBorder__full_notice_title')}
          </h1>
          <ol className={tw('mt-6 flex flex-col gap-5')}>
            {items.map(item => (
              <li key={item.title}>
                <h2 className={tw('type-title-small')}>{item.title}</h2>
                <p className={tw('mt-1 type-body-large whitespace-pre-line')}>
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
          <div className={tw('mt-6 flex flex-col items-start gap-2')}>
            <a
              className={linkClassName}
              href={TELLOMI_PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
            >
              {i18n('icu:TellomiCrossBorder__privacy_link')}
            </a>
            <a
              className={linkClassName}
              href={TELLOMI_THIRD_PARTY_LIST_URL}
              target="_blank"
              rel="noreferrer"
            >
              {i18n('icu:TellomiCrossBorder__third_party_link')}
            </a>
          </div>
        </div>
      </div>
      <div
        className={tw('flex justify-center border-t border-primary px-8 py-4')}
      >
        <AxoButton.Root variant="strong-secondary" size="lg" onClick={onClose}>
          {i18n('icu:TellomiCrossBorder__full_notice_close')}
        </AxoButton.Root>
      </div>
    </div>
  );
}
