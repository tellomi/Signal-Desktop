// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import enMessages from '../../../../_locales/en/messages.json';
import zhCNMessages from '../../../../_locales/zh-CN/messages.json';
import { TellomiComposerUpdateRequired } from '../../../components/conversation/TellomiComposerUpdateRequired.dom.tsx';
import { setupI18n } from '../../../util/setupI18n.dom.tsx';
import { AppProvider } from '../../../windows/AppProvider.dom.tsx';

// Tellomi (tellomi/tellomi#1399, spec app-update-and-version-policy.md §3.4 "read-only"): the composer is replaced
// while this version is read-only; same wording as Android's DisabledInputView.
describe('<TellomiComposerUpdateRequired>', () => {
  let container: HTMLElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('says an update is needed and the button runs onUpdate', () => {
    let clicks = 0;
    flushSync(() => {
      root.render(
        <AppProvider>
          <TellomiComposerUpdateRequired
            i18n={setupI18n('zh-CN', zhCNMessages)}
            onUpdate={() => {
              clicks += 1;
            }}
          />
        </AppProvider>
      );
    });
    assert.include(container.textContent, '此版本需要更新才能收发消息。');
    const button = container.querySelector('button');
    assert.isNotNull(button);
    assert.strictEqual(button?.textContent, '立即更新');
    button?.click();
    assert.strictEqual(clicks, 1);
  });

  it('has no button while an update is already downloading', () => {
    flushSync(() => {
      root.render(
        <AppProvider>
          <TellomiComposerUpdateRequired
            i18n={setupI18n('en', enMessages)}
            onUpdate={undefined}
          />
        </AppProvider>
      );
    });
    assert.include(
      container.textContent,
      'This version needs an update to send and receive messages.'
    );
    assert.isNull(container.querySelector('button'));
  });
});
