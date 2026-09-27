// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import {
  UsernameEditor,
  UsernameRulesHint,
} from '../../components/UsernameEditor.dom.tsx';
import { UsernameReservationState } from '../../state/ducks/usernameEnums.std.ts';
import type { LocalizerType } from '../../types/Util.std.ts';

// Tellomi（ADR-0066 §6.1b）：输入框下面常驻一行灰色规则提示；打了大写被转成小写时，这一行短暂换成「已自动转成小写」
// （不是红字）；其他不合规字符照旧走下面的红字错误。
describe('<UsernameEditor /> lowercase hint (ADR-0066 §6.1b)', () => {
  const i18n = ((key: string) => `[${key}]`) as unknown as LocalizerType;
  const noop = () => undefined;

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

  const RULES = '[icu:EditUsernameModalBody__username-rules--tellomi]';
  const LOWERCASED =
    '[icu:EditUsernameModalBody__username-lowercased--tellomi]';

  describe('UsernameRulesHint', () => {
    it('shows the rules in grey by default', () => {
      const html = render(
        <UsernameRulesHint i18n={i18n} isShowingLowercased={false} />
      );
      assert.include(html, RULES);
      assert.notInclude(html, LOWERCASED);
      assert.include(html, 'class="UsernameEditor__rules"');
      assert.notInclude(html, 'UsernameEditor__error');
    });

    it('swaps to “converted to lowercase”, still grey, announced politely', () => {
      const html = render(
        <UsernameRulesHint i18n={i18n} isShowingLowercased />
      );
      assert.include(html, LOWERCASED);
      assert.notInclude(html, RULES);
      assert.include(html, 'class="UsernameEditor__rules"');
      assert.notInclude(html, 'UsernameEditor__error');
      assert.include(html, 'aria-live="polite"');
    });
  });

  describe('UsernameEditor', () => {
    function renderEditor(currentUsername: string | undefined): string {
      return render(
        <UsernameEditor
          i18n={i18n}
          currentUsername={currentUsername}
          usernameCorrupted={false}
          state={UsernameReservationState.Open}
          recoveredUsername={undefined}
          minNickname={3}
          maxNickname={20}
          setUsernameReservationError={noop}
          clearUsernameReservation={noop}
          reserveUsername={noop}
          confirmUsername={noop}
          showToast={noop}
          onClose={noop}
        />
      );
    }

    it('puts the rule hint right under the field, before the rest of the helper text', () => {
      const html = renderEditor(undefined);
      const input = html.indexOf('<input');
      const rules = html.indexOf(RULES);
      const purpose = html.indexOf(
        '[icu:EditUsernameModalBody__username-purpose--tellomi]'
      );
      assert.isAbove(input, -1);
      assert.isAbove(rules, input);
      assert.isAbove(purpose, rules);
      assert.notInclude(
        html,
        '[icu:EditUsernameModalBody__username-helper--tellomi]'
      );
    });

    it('shows an old mixed-case username in lowercase, in the preview and the field', () => {
      const html = renderEditor('KaiXin.01');
      assert.notInclude(html, 'KaiXin');
      assert.include(html, 'value="kaixin"');
      assert.include(html, '>kaixin<');
    });
  });
});
