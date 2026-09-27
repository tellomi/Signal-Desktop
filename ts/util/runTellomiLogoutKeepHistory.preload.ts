// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { itemStorage } from '../textsecure/Storage.preload.ts';
import {
  getSocketStatus,
  removeOurLinkedDevice,
} from '../textsecure/WebAPI.preload.ts';
import { SocketStatus } from '../types/SocketStatus.std.ts';
import type { TellomiLogoutKeepHistoryResult } from './tellomiLogoutKeepHistory.std.ts';
import { tellomiLogoutKeepHistory } from './tellomiLogoutKeepHistory.std.ts';

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4）：把「退出登录（保留聊天记录）」的步骤接到 Desktop 现有的零件上。
// 步骤本身和测试在 tellomiLogoutKeepHistory.std.ts。
export function runTellomiLogoutKeepHistory({
  showNeedsNetwork,
}: Readonly<{
  showNeedsNetwork: () => void;
}>): Promise<TellomiLogoutKeepHistoryResult> {
  return tellomiLogoutKeepHistory({
    getOurDeviceId: () => itemStorage.user.getDeviceId(),
    isConnected: () =>
      getSocketStatus().authenticated.status === SocketStatus.OPEN,
    removeOurDevice: removeOurLinkedDevice,
    // 现有的「被取消关联」路径（background.preload.ts 的 unlinkAndDisconnect）：断开、清本地配置、
    // 保留会话；完成后回调。
    unlinkAndDisconnect: () =>
      new Promise<void>(resolve => {
        window.Whisper.events.emit('unlinkAndDisconnect', resolve);
      }),
    showNeedsNetwork,
  });
}
