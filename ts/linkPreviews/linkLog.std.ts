// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0063 §6.5 / §8.1 row 9: link logs carry the provider, route, level and the kind of failure,
// never the URL or its `#` part. An error's message may quote the URL it failed on (the native
// bridge, the OS handing it to a browser), so only the error's kind is logged.

const SHORT_CODE = /^[\w.-]{1,32}$/;

export function getLinkErrorKind(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error;
  }
  const { code } = error as Error & { code?: unknown };
  if (
    (typeof code === 'string' && SHORT_CODE.test(code)) ||
    typeof code === 'number'
  ) {
    return `${error.name}(${code})`;
  }
  return error.name;
}
