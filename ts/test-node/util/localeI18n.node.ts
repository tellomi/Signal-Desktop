// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import lodash from 'lodash';

import type { LocaleMessagesType } from '../../types/I18N.std.ts';
import type { LocalizerType } from '../../types/Util.std.ts';
import { setupI18n } from '../../util/setupI18nMain.std.ts';
import { shouldNeverBeCalled } from '../../util/shouldNeverBeCalled.std.ts';

const { merge } = lodash;

// The four languages the link cards are specified in (card-visual §3.10): the folder names under
// `_locales`. `zh-Hant` is Taiwan's traditional Chinese, `zh-HK` Hong Kong's.
export const CARD_LOCALES = ['en', 'zh-CN', 'zh-HK', 'zh-Hant'] as const;
export type CardLocaleType = (typeof CARD_LOCALES)[number];

const LOCALES_DIR = join(__dirname, '..', '..', '..', '_locales');

// `messages.json` of one language, as it is on disk.
export function readLocaleMessages(locale: string): LocaleMessagesType {
  return JSON.parse(
    readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8')
  );
}

// The localizer the app builds for `locale` (app/locale.node.ts): English underneath, the
// language's own strings over it, real ICU for plurals, numbers and dates.
export function getLocaleI18n(locale: string): LocalizerType {
  return setupI18n(
    locale,
    merge({}, readLocaleMessages('en'), readLocaleMessages(locale)),
    {
      renderEmojify: shouldNeverBeCalled,
      getLocaleDirection: shouldNeverBeCalled,
      getHourCyclePreference: shouldNeverBeCalled,
    }
  );
}
