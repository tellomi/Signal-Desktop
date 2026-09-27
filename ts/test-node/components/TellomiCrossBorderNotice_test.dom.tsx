// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import {
  TellomiCrossBorderFullNotice,
  TellomiCrossBorderNoticeDialogBody,
} from '../../components/TellomiCrossBorderNotice.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

// Tellomi（tellomi/tellomi#1338）：需求说明 6.6 的「关联设备」弹窗——DIALOG_TITLE · LINKED_DIALOG_BODY ·
// 链接 DIALOG_FULL_NOTICE_LINK · 一个「知道了」；点链接出全文页：FULL_NOTICE_TITLE · 9 项（第 9 项正文用
// LINKED_ITEM_CONSENT_BODY）· PRIVACY_LINK · THIRD_PARTY_LINK · FULL_NOTICE_CLOSE。
// 弹窗的标题和「知道了」在 Modal 里（portal，服务端渲染不了），在 Desktop 实测里核。
describe('<TellomiCrossBorderNotice /> (tellomi/tellomi#1338, spec §6.6)', () => {
  const i18n = ((key: string) => `[${key}]`) as unknown as LocalizerType;
  const noop = () => null;

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
        {element}
      </AxoProvider>
    );
  }

  function assertInOrder(html: string, suffixes: ReadonlyArray<string>) {
    let cursor = -1;
    for (const suffix of suffixes) {
      const key = `[icu:TellomiCrossBorder__${suffix}]`;
      const index = html.indexOf(key);
      assert.isAbove(index, cursor, `${key} missing or out of order`);
      assert.strictEqual(
        html.indexOf(key, index + 1),
        -1,
        `${key} rendered more than once`
      );
      cursor = index;
    }
  }

  describe('dialog body', () => {
    it('is the linked-device body plus a link to the full notice, nothing else', () => {
      const html = render(
        <TellomiCrossBorderNoticeDialogBody
          i18n={i18n}
          onOpenFullNotice={noop}
        />
      );
      assertInOrder(html, ['linked_dialog_body', 'dialog_full_notice_link']);
      assert.notInclude(html, '__item_');
      assert.notInclude(html, '__linked_item_consent_body');
      assert.notInclude(html, 'TellomiConsent__');
    });

    it('opens the full notice in the app, not on the website', () => {
      const html = render(
        <TellomiCrossBorderNoticeDialogBody
          i18n={i18n}
          onOpenFullNotice={noop}
        />
      );
      assert.notInclude(html, 'href=');
      assert.strictEqual(html.match(/<button/g)?.length, 1);
    });
  });

  describe('full notice', () => {
    it('shows the title, the 9 items (linked item 9), the two links and Back, in order', () => {
      const html = render(
        <TellomiCrossBorderFullNotice i18n={i18n} onClose={noop} />
      );
      assertInOrder(html, [
        'full_notice_title',
        'item_where_title',
        'item_where_body',
        'item_recipients_title',
        'item_recipients_body',
        'item_contact_title',
        'item_contact_body',
        'item_purpose_title',
        'item_purpose_body',
        'item_method_title',
        'item_method_body',
        'item_kinds_title',
        'item_kinds_body',
        'item_rights_title',
        'item_rights_body',
        'item_procedure_title',
        'item_procedure_body',
        'item_consent_title',
        'linked_item_consent_body',
        'privacy_link',
        'third_party_link',
        'full_notice_close',
      ]);
    });

    it('has exactly one button (Back) and nothing that asks for consent or acknowledges', () => {
      const html = render(
        <TellomiCrossBorderFullNotice i18n={i18n} onClose={noop} />
      );
      assert.strictEqual(html.match(/<button/g)?.length, 1);
      assert.notInclude(html, '[icu:TellomiCrossBorder__item_consent_body]');
      assert.notInclude(html, '[icu:TellomiCrossBorder__linked_ack]');
      assert.notInclude(html, '[icu:TellomiCrossBorder__dialog_');
      assert.notInclude(html, 'TellomiConsent__');
    });

    it('links to the privacy policy and the third-party list', () => {
      const html = render(
        <TellomiCrossBorderFullNotice i18n={i18n} onClose={noop} />
      );
      assert.include(html, 'href="https://www.tellomi.app/legal/privacy/"');
      assert.include(html, 'href="https://www.tellomi.app/legal/third-party/"');
    });
  });
});
