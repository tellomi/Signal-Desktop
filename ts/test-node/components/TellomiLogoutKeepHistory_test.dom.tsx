// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import { AxoItem } from '../../axo/items/AxoItem.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import { TellomiLogoutKeepHistoryItem } from '../../components/TellomiLogoutKeepHistory.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4）：设置 → 通用里「删除应用数据」旁边的一行
// 「退出登录（保留聊天记录）」+ 一个「退出登录」按钮；点了才出确认弹窗（标题「退出登录？」、正文、
// 「退出登录」「取消」）。弹窗在 portal 里，服务端渲染不出来，这里只核这一行本身、以及弹窗默认不打开。
describe('<TellomiLogoutKeepHistoryItem /> (tellomi/tellomi#1414)', () => {
  const i18n = ((key: string) => `[${key}]`) as unknown as LocalizerType;
  const onLogout = () => Promise.resolve();

  function render(element: ReactNode): string {
    return renderToStaticMarkup(
      <AxoProvider
        resolvedAppLocale={{
          tag: 'en' as AxoIntl.AppLocaleTag,
          direction: 'ltr',
        }}
        systemPreferredLanguages={new Set()}
        messages={{} as AxoIntl.Messages}
      >
        <AxoItem.Group>{element}</AxoItem.Group>
      </AxoProvider>
    );
  }

  const ROW = '[icu:Preferences__logout-keep-history--tellomi]';
  const BUTTON = '[icu:Preferences__logout-button--tellomi]';
  const TITLE = '[icu:Preferences__logout-confirm-title--tellomi]';
  const BODY = '[icu:Preferences__logout-confirm-body--tellomi]';

  function count(html: string, needle: string): number {
    return html.split(needle).length - 1;
  }

  it('is one row: the label and a single “Log out” button', () => {
    const html = render(
      <TellomiLogoutKeepHistoryItem i18n={i18n} onLogout={onLogout} />
    );
    assert.strictEqual(count(html, ROW), 1);
    assert.strictEqual(count(html, BUTTON), 1);
    assert.strictEqual(count(html, '<button'), 1);
    assert.isBelow(html.indexOf(ROW), html.indexOf(BUTTON));
  });

  it('does not open the confirmation until the button is pressed', () => {
    const html = render(
      <TellomiLogoutKeepHistoryItem i18n={i18n} onLogout={onLogout} />
    );
    assert.notInclude(html, TITLE);
    assert.notInclude(html, BODY);
    assert.notInclude(html, 'role="alertdialog"');
  });

  it('never mentions deleting data', () => {
    const html = render(
      <TellomiLogoutKeepHistoryItem i18n={i18n} onLogout={onLogout} />
    );
    assert.notInclude(html, 'clearData');
    assert.notInclude(html, 'deleteAllData');
  });
});
