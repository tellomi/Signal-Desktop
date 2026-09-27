// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';

import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import { TellomiCrossBorderNotice } from '../../components/TellomiCrossBorderNotice.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

// Tellomi（tellomi/tellomi#1338）：只读版 = LINKED_TITLE · LINKED_INTRO · 9 项（第 9 项正文换成 LINKED_ITEM_CONSENT_BODY）
// · PRIVACY_LINK · THIRD_PARTY_LINK · 一个按钮 LINKED_ACK（需求说明 6.3「三种用法」）。
describe('<TellomiCrossBorderNotice /> (tellomi/tellomi#1338)', () => {
  const i18n = ((key: string) => `[${key}]`) as unknown as LocalizerType;

  function render(): string {
    return renderToStaticMarkup(
      <AxoProvider
        resolvedAppLocale={{
          tag: 'en' as AxoIntl.AppLocaleTag,
          direction: 'ltr',
        }}
        systemPreferredLanguages={new Set()}
        messages={{} as AxoIntl.Messages}
      >
        <TellomiCrossBorderNotice i18n={i18n} onAcknowledge={() => null} />
      </AxoProvider>
    );
  }

  it('shows the read-only notice in the spec order', () => {
    const html = render();
    const expectedOrder = [
      'linked_title',
      'linked_intro',
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
      'linked_ack',
    ].map(suffix => `[icu:TellomiCrossBorder__${suffix}]`);

    let cursor = -1;
    for (const key of expectedOrder) {
      const index = html.indexOf(key);
      assert.isAbove(index, cursor, `${key} missing or out of order`);
      assert.strictEqual(
        html.indexOf(key, index + 1),
        -1,
        `${key} rendered more than once`
      );
      cursor = index;
    }
  });

  it('has exactly one button and nothing that asks for consent', () => {
    const html = render();
    assert.strictEqual(html.match(/<button/g)?.length, 1);
    assert.notInclude(html, '[icu:TellomiCrossBorder__item_consent_body]');
    assert.notInclude(html, '[icu:TellomiCrossBorder__disagree_hint]');
    assert.notInclude(html, 'TellomiConsent__');
  });

  it('links to the privacy policy and the third-party list', () => {
    const html = render();
    assert.include(html, 'href="https://www.tellomi.app/legal/privacy/"');
    assert.include(html, 'href="https://www.tellomi.app/legal/third-party/"');
  });
});
