// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagedLinkPreview } from '../../components/conversation/StagedLinkPreview.dom.tsx';
import type { CardLocaleType } from '../util/localeI18n.node.ts';
import { CARD_LOCALES, getLocaleI18n } from '../util/localeI18n.node.ts';
import type { LocalizerType } from '../../types/Util.std.ts';

// ADR-0063 §5.1 rule 2 and §8.1 row 4 (audit L1): when the group link in the text box is
// definitely not active, the sender is told so in place of a preview, with the same words in every
// language and on every platform. Until now this component had a story and no test.

// The words, as the other two platforms have them: Android `LinkPreviewView_this_group_link_is_not_active`
// (`values`, `values-zh-rCN`, `values-zh-rHK`, `values-zh-rTW`) and iOS
// `TELLOMI_LINK_PREVIEW_GROUP_LINK_NOT_ACTIVE` (`en`, `zh_CN`, `zh_HK`, `zh_TW` `.lproj`), found by
// `grep -F` on each of these four strings in the `clients/android` and `clients/ios` checkouts.
const HINT: Readonly<Record<CardLocaleType, string>> = {
  en: 'This group link is not active',
  'zh-CN': '此群组链接未激活',
  'zh-HK': '此群組連結不在使用中',
  'zh-Hant': '此群組連結無效',
};

const URL_OF_GROUP = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// What the composer's state holds for an inactive group link: the URL and the flag, nothing else
// (linkPreviews duck `showGroupLinkInactive`). The props that follow are what a preview of a
// group would carry; none of them may show.
function render(
  i18n: LocalizerType,
  onClose?: () => void
): { markup: string; element: ReactElement } {
  const element = StagedLinkPreview({
    url: URL_OF_GROUP,
    isGroupLinkInactive: true,
    title: 'Book club',
    description: '12 members',
    domain: 'tell.cc',
    date: 1_700_000_000_000,
    i18n,
    onClose,
  });
  return { markup: renderToStaticMarkup(element), element };
}

// The buttons in a tree of React elements, in order.
function findButtons(
  node: ReactNode
): Array<ReactElement<{ onClick?: () => void }>> {
  if (Array.isArray(node)) {
    return node.flatMap(findButtons);
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) {
    return [];
  }
  return [
    ...(node.type === 'button' ? [node] : []),
    ...findButtons(node.props.children),
  ];
}

describe('<StagedLinkPreview /> for a group link that is not active', () => {
  for (const locale of CARD_LOCALES) {
    describe(`in ${locale}`, () => {
      const i18n = getLocaleI18n(locale);

      it('says that it is not active, in the words of every platform', () => {
        const { markup } = render(i18n);
        assert.include(
          markup,
          `<div class="module-staged-link-preview__title">${HINT[locale]}</div>`
        );
        // The string file says the same.
        assert.strictEqual(
          i18n('icu:TellomiLinkCard__group_link_inactive'),
          HINT[locale]
        );
      });

      it('shows that and nothing of the group, in place of a preview', () => {
        const { markup } = render(i18n);
        assert.notInclude(markup, 'Book club');
        assert.notInclude(markup, '12 members');
        assert.notInclude(markup, 'tell.cc');
        assert.notInclude(markup, '<img');
        assert.notInclude(markup, 'module-staged-link-preview__footer');
        assert.notInclude(markup, 'module-staged-link-preview__description');
        assert.include(
          markup,
          'module-staged-link-preview--group-link-inactive'
        );
        assert.include(markup, 'dir="auto"');
      });

      it('has a close button named in the language, when it can be closed', () => {
        const { markup } = render(i18n, () => undefined);
        assert.strictEqual(markup.match(/<button/g)?.length, 1);
        assert.include(markup, `aria-label="${i18n('icu:close')}"`);
        assert.include(markup, 'module-staged-link-preview__close-button');
      });

      it('has no close button when it cannot be closed', () => {
        const { markup } = render(i18n);
        assert.notInclude(markup, '<button');
      });

      it('closes when the button is pressed', () => {
        const onClose = sinon.spy();
        const { element } = render(i18n, onClose);
        const [button, ...others] = findButtons(element);
        assert.lengthOf(others, 0);
        assert.isDefined(button);
        button?.props.onClick?.();
        sinon.assert.calledOnce(onClose);
      });
    });
  }
});
