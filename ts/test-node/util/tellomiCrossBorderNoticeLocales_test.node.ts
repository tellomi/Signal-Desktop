// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from 'chai';

// Tellomi（tellomi/tellomi#1338）：Desktop 只读告知的文案要在 en / zh-CN / zh-HK / zh-Hant 四种语言里齐全（需求说明 6.3），
// yue 用 zh_HK 的文字（否则粤语系统回落到英文）。「境外接收方」是 Desktop 版：Apple 和 Google 两行都列（Desktop 的推送走手机）。
describe('tellomiCrossBorderNotice locales (tellomi/tellomi#1338)', () => {
  const KEYS = [
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
  ].map(suffix => `icu:TellomiCrossBorder__${suffix}`);

  type Entry = { messageformat?: string; description?: string };

  function load(locale: string): Record<string, Entry> {
    return JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '_locales', locale, 'messages.json'),
        'utf8'
      )
    );
  }

  for (const locale of ['en', 'zh-CN', 'zh-HK', 'zh-Hant', 'yue']) {
    it(`${locale} has every key`, () => {
      const messages = load(locale);
      for (const key of KEYS) {
        const text = messages[key]?.messageformat;
        assert.isString(text, `${locale} ${key}`);
        assert.isAbove(text?.trim().length ?? 0, 0, `${locale} ${key}`);
      }
    });

    it(`${locale} lists both Apple and Google as recipients (Desktop variant)`, () => {
      const body =
        load(locale)['icu:TellomiCrossBorder__item_recipients_body']
          ?.messageformat ?? '';
      const lines = body.split('\n');
      assert.lengthOf(lines, 6, body);
      for (const line of lines) {
        assert.match(line, /^· /);
      }
      assert.match(lines[3] ?? '', /^· Apple Inc\..*APNs/);
      assert.match(lines[4] ?? '', /^· Google LLC.*FCM/);
    });
  }

  it('en describes every key', () => {
    const messages = load('en');
    for (const key of KEYS) {
      assert.isAbove(messages[key]?.description?.length ?? 0, 20, key);
    }
  });

  it('yue uses the zh_HK text', () => {
    const zhHK = load('zh-HK');
    const yue = load('yue');
    for (const key of KEYS) {
      assert.strictEqual(
        yue[key]?.messageformat,
        zhHK[key]?.messageformat,
        key
      );
    }
  });

  it('the only button says “知道了” / “Got It”', () => {
    assert.strictEqual(
      load('zh-CN')['icu:TellomiCrossBorder__linked_ack']?.messageformat,
      '知道了'
    );
    assert.strictEqual(
      load('en')['icu:TellomiCrossBorder__linked_ack']?.messageformat,
      'Got It'
    );
  });
});
