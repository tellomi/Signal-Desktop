// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useRef } from 'react';
import type { JSX } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { TitlebarDragArea } from './TitlebarDragArea.dom.tsx';
import type { LocalizerType } from '../types/Util.std.ts';
import {
  TELLOMI_PRIVACY_POLICY_URL,
  TELLOMI_THIRD_PARTY_LIST_URL,
} from '../util/tellomiCrossBorderNotice.std.ts';

export type PropsType = Readonly<{
  i18n: LocalizerType;
  onAcknowledge: () => void;
}>;

// Tellomi（tellomi/tellomi#1338）：跨境告知的「关联设备（只读）」版，整窗显示（需求说明 6.3「三种用法」第三行）：
// LINKED_TITLE · LINKED_INTRO · 9 项（第 9 项正文换成 LINKED_ITEM_CONSENT_BODY）· 两个链接 · 一个「知道了」。
// 不收集同意（同意在手机上取得），所以没有「同意 / 不同意」；也不默认聚焦按钮（需求说明 2.2）。
// 页面本身不发起任何网络请求：链接交给系统浏览器打开（主进程 will-navigate / setWindowOpenHandler → shell.openExternal）。
export function TellomiCrossBorderNotice({
  i18n,
  onAcknowledge,
}: PropsType): JSX.Element {
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
      <TitlebarDragArea />
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
            {i18n('icu:TellomiCrossBorder__linked_title')}
          </h1>
          <p className={tw('mt-3 type-body-large')}>
            {i18n('icu:TellomiCrossBorder__linked_intro')}
          </p>
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
        <AxoButton.Root
          variant="strong-primary"
          size="lg"
          onClick={onAcknowledge}
        >
          {i18n('icu:TellomiCrossBorder__linked_ack')}
        </AxoButton.Root>
      </div>
    </div>
  );
}
