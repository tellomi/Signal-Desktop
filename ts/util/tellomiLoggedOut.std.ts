// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { AppViewType } from '../types/app.std.ts';

// Tellomi（tellomi/tellomi#1414，需求 §3.2 安全要求，ADR-0072 §4.4）：Desktop「退出登录（保留聊天记录）」之后，
// 本机数据原样留在磁盘上，但重新关联之前不许看到任何会话。用一个存储项 tellomiLoggedOut 记这件事：
// - 只有我们的「退出登录」在服务器删掉本机之后写它；手机那边取消关联（上游的「未连接」）不写，聊天列表照旧能看；
// - 它在 STORAGE_KEYS_TO_PRESERVE_AFTER_UNLINK 里，unlinkAndDisconnect 清配置时不会被清掉；
// - 它在的时候：启动直接进关联二维码页；任何「打开聊天列表」都改成关联页（已经在关联页就不动）；
//   通知不弹；角标 / 托盘图标 / 窗口标题的未读数一律 0；
// - 重新关联完成（AccountManager 的 registrationDone，同一账号或另一个账号）时清掉。同一账号：会话都回来；
//   另一个账号：上游本来就先 removeAllData 清空。

export type TellomiLoggedOutStorage = Readonly<{
  get: (key: 'tellomiLoggedOut') => boolean | undefined;
  put: (key: 'tellomiLoggedOut', value: boolean) => Promise<void>;
  remove: (key: 'tellomiLoggedOut') => Promise<void>;
}>;

export function isTellomiLoggedOut(items: {
  readonly tellomiLoggedOut?: boolean;
}): boolean {
  return items.tellomiLoggedOut === true;
}

export async function markTellomiLoggedOut(
  storage: TellomiLoggedOutStorage
): Promise<void> {
  await storage.put('tellomiLoggedOut', true);
}

// 不先看 get：关联到另一个账号时 removeAllData 已经把存储重新读过一遍（这一项已经没了），但 redux 里的 items
// 不跟着重置，还留着 true；照样 remove 一次，redux 才会跟着清掉，关联完成后才进得了聊天列表。
export async function clearTellomiLoggedOut(
  storage: TellomiLoggedOutStorage
): Promise<void> {
  await storage.remove('tellomiLoggedOut');
}

export type TellomiOpenInboxDecision = 'open-inbox' | 'open-relink' | 'stay';

// app/openInbox 是进聊天列表的唯一一道门
export function decideTellomiOpenInbox({
  isLoggedOut,
  appView,
}: {
  isLoggedOut: boolean;
  appView: AppViewType;
}): TellomiOpenInboxDecision {
  if (!isLoggedOut) {
    return 'open-inbox';
  }
  // 已经在关联页（包括正在关联中）就留在那里，不重新开始关联
  if (appView === AppViewType.Installer) {
    return 'stay';
  }
  return 'open-relink';
}

// 启动时第一个界面：上游是「关联过且核心数据齐全 → 聊天列表，否则 → 关联页」
export function shouldTellomiStartOnInbox({
  isCoreDataValid,
  registrationEverDone,
  isLoggedOut,
}: {
  isCoreDataValid: boolean;
  registrationEverDone: boolean;
  isLoggedOut: boolean;
}): boolean {
  return isCoreDataValid && registrationEverDone && !isLoggedOut;
}

// 角标、托盘图标、窗口标题共用的未读数
export function getTellomiBadgeCount(
  unreadTotal: number,
  isLoggedOut: boolean
): number {
  return isLoggedOut ? 0 : unreadTotal;
}
