// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi（ADR-0066 §6.1b，owner 2026-09-27）：用户名一律小写。三端一致的输入规则：
// 打了大写字母（包括粘贴）当场转成小写，光标位置不跳；规则提示那一行短暂换成「已自动转成小写」（约 2 秒，不用红色），
// 然后恢复。其他不合规的字符（空格、中文、减号、点……）不动，照旧由就地的红字错误提示，不自动删。

// 「已自动转成小写」显示多久
export const LOWERCASED_HINT_MS = 2000;

export type NicknameInputState = Readonly<{
  value: string;
  selectionStart: number;
  selectionEnd: number;
}>;

// 只转 A–Z：libsignal 的 nickname 只认 a-z 0-9 _，其他字母（É、İ……）本来就不合规，留给红字错误；
// 而且只转 ASCII 长度不变（'İ'.toLowerCase() 是两个码元），光标和选区原样保留就不会跳。
export function lowercaseNicknameInput(
  state: NicknameInputState
): NicknameInputState & Readonly<{ changed: boolean }> {
  const value = state.value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  return {
    value,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    changed: value !== state.value,
  };
}

export type TemporaryFlag = Readonly<{
  trigger: () => void;
  dispose: () => void;
}>;

// trigger() 立刻报 true，durationMs 之后报 false；期间再 trigger 就从头计时。dispose() 之后不再回调。
export function createTemporaryFlag(
  durationMs: number,
  onChange: (on: boolean) => void
): TemporaryFlag {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  return {
    trigger() {
      if (disposed) {
        return;
      }
      if (timer === undefined) {
        onChange(true);
      } else {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        onChange(false);
      }, durationMs);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
