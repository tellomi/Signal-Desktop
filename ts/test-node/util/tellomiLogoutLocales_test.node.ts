// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from 'chai';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4 / §4.5）：
// - 「退出登录（保留聊天记录）」这一行、确认弹窗和「需要联网」提示的文案在 en / zh-CN / zh-HK / zh-Hant / yue 都齐；
//   zh-CN 是需求原文，一字不改。
// - 用词（需求 §3.1）：「注销」只指注销账号（删号）。中文界面里不许用「注销 / 註銷」指设备被登出、取消关联——
//   上游翻译同步时容易带回来，这里钉住：含这两个字的只能是下面白名单里讲注销账号的句子。
describe('Tellomi logout strings (tellomi/tellomi#1414, ADR-0072 §4.4–4.5)', () => {
  type Entry = { messageformat?: string; description?: string };

  function load(locale: string): Record<string, Entry> {
    return JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '_locales', locale, 'messages.json'),
        'utf8'
      )
    );
  }

  const ROW = 'icu:Preferences__logout-keep-history--tellomi';
  const BUTTON = 'icu:Preferences__logout-button--tellomi';
  const TITLE = 'icu:Preferences__logout-confirm-title--tellomi';
  const BODY = 'icu:Preferences__logout-confirm-body--tellomi';
  const NEEDS_NETWORK = 'icu:Toast--logout-needs-network--tellomi';
  const KEYS = [ROW, BUTTON, TITLE, BODY, NEEDS_NETWORK];

  const CHINESE_LOCALES = ['zh-CN', 'zh-HK', 'zh-Hant', 'yue'];

  for (const locale of ['en', ...CHINESE_LOCALES]) {
    it(`${locale} has every logout string`, () => {
      const messages = load(locale);
      for (const key of KEYS) {
        const text = messages[key]?.messageformat;
        assert.isString(text, `${locale} ${key}`);
        assert.isAbove(text?.trim().length ?? 0, 0, `${locale} ${key}`);
      }
    });
  }

  it('en describes every new string for translators', () => {
    const messages = load('en');
    for (const key of KEYS) {
      assert.isAbove(
        messages[key]?.description?.trim().length ?? 0,
        0,
        `en ${key} description`
      );
    }
  });

  it('zh-CN is the exact copy from the spec', () => {
    const messages = load('zh-CN');
    assert.deepStrictEqual(
      Object.fromEntries(KEYS.map(key => [key, messages[key]?.messageformat])),
      {
        [ROW]: '退出登录（保留聊天记录）',
        [BUTTON]: '退出登录',
        [TITLE]: '退出登录？',
        [BODY]:
          '这台电脑上的聊天记录会保留。用手机重新扫码关联同一个账号后恢复。',
        [NEEDS_NETWORK]: '退出登录需要联网，请稍后再试。',
      }
    );
  });

  it('the Chinese logout strings never say 注销 / 註銷', () => {
    for (const locale of CHINESE_LOCALES) {
      const messages = load(locale);
      for (const key of KEYS) {
        assert.notMatch(
          messages[key]?.messageformat ?? '',
          /注销|註銷|注銷/,
          `${locale} ${key}`
        );
      }
    }
  });

  // 只有这些句子可以出现「注销 / 註銷」：都是在讲注销账号（删号）。
  const ACCOUNT_DELETION_KEYS = new Set([
    'icu:TellomiCrossBorder__item_method_body',
    'icu:TellomiCrossBorder__item_rights_body',
  ]);

  for (const locale of CHINESE_LOCALES) {
    it(`${locale} uses 注销 / 註銷 only for deleting the account`, () => {
      const offenders = Object.entries(load(locale))
        .filter(([, entry]) => /注销|註銷|注銷/.test(entry.messageformat ?? ''))
        .map(([key]) => key)
        .filter(key => !ACCOUNT_DELETION_KEYS.has(key));
      assert.deepStrictEqual(offenders, []);
    });
  }
});
