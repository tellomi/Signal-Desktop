// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
import { ESLintUtils } from '@typescript-eslint/utils';

// Tellomi: files Tellomi wrote carry "Copyright <year> Tellomi"; upstream files keep Signal's
// line. The fix keeps whichever holder the file already names, so it never rewrites one into
// the other.
const HOLDER = '(Signal Messenger, LLC|Tellomi)';
const COMMENT_LINE_1_EXACT = new RegExp(`^ Copyright \\d{4} ${HOLDER}$`);
const COMMENT_LINE_2_EXACT = /^ SPDX-License-Identifier: AGPL-3.0-only$/;

const COMMENT_LINE_1_LOOSE = new RegExp(`Copyright (\\d{4}) ${HOLDER}`);
const COMMENT_LINE_2_LOOSE = /SPDX-License-Identifier: AGPL-3.0-only/;

export const enforceLicenseComments = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'problem',
    fixable: 'code',
    messages: {
      missingLicenseComment: 'Missing license comment',
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    return {
      Program(node) {
        const comment1 = node.comments?.at(0);
        const comment2 = node.comments?.at(1);

        if (
          comment1?.type === 'Line' &&
          comment2?.type === 'Line' &&
          COMMENT_LINE_1_EXACT.test(comment1.value) &&
          COMMENT_LINE_2_EXACT.test(comment2.value)
        ) {
          return;
        }

        context.report({
          node,
          messageId: 'missingLicenseComment',
          fix(fixer) {
            let year = null;
            let holder = null;
            const remove = [];

            for (const comment of node.comments ?? []) {
              const match1 = comment.value.match(COMMENT_LINE_1_LOOSE);
              const match2 = comment.value.match(COMMENT_LINE_2_LOOSE);

              if (match1 != null) {
                year = match1[1];
                holder = match1[2];
              }

              if (match1 != null || match2 != null) {
                remove.push(comment);
              }
            }

            year ??= new Date().getFullYear().toString();
            holder ??= 'Signal Messenger, LLC';

            const insert =
              `// Copyright ${year} ${holder}\n` +
              '// SPDX-License-Identifier: AGPL-3.0-only\n';

            return [
              fixer.replaceTextRange([0, 0], insert),
              ...remove.map(comment => {
                return fixer.replaceTextRange(
                  [comment.range[0], comment.range[1]],
                  ''
                );
              }),
            ];
          },
        });
      },
    };
  },
});
