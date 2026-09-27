// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import * as Errors from '../types/errors.std.ts';

const log = createLogger('tellomiLogoutKeepHistory');

// Tellomi（tellomi/tellomi#1414，ADR-0072 §4.4，需求 §3.2 安全要求）：Desktop 正式包永远是已链接设备。
// 「退出登录（保留聊天记录）」= 本机调 DELETE /v1/devices/{本机 id} 把自己从账号里删掉（服务端允许已链接设备删自己、
// 不许删主设备，server DeviceController.removeDevice），成功后：
// 1. 先记下「已退出登录」标记（tellomiLoggedOut，见 tellomiLoggedOut.std.ts）。它在 unlink 要保留的存储项里，
//    所以服务器断开连接触发的那次 unlinkAndDisconnect 也清不掉它；标记在，就看不到任何会话；
// 2. 清掉已经弹出来的通知；
// 3. **马上**走现有的 unlinkAndDisconnect（不等之后 WebSocket 或请求撞上 403）。它只清本地配置
//    （removeAllConfiguration(isPrimary=false)），会话和消息留在本机磁盘上；
// 4. 直接进关联二维码页（和左栏「重新关联」同一条路）。
// 用同一个账号重新关联会话就回来，关联到另一个账号会清空——都是现有行为（AccountManager.createAccount +
// isRelinkingToSameAccount）；关联完成时清掉标记。
// 没连上服务器或服务器没删成功：提示「退出登录需要联网，请稍后再试。」，本机什么都不改（不记标记），仍是已关联状态。

const PRIMARY_DEVICE_ID = 1;

export type TellomiLogoutKeepHistoryResult =
  | 'logged-out'
  | 'failed'
  | 'not-a-linked-device';

export type TellomiLogoutKeepHistoryDeps = Readonly<{
  // 本机在账号里的设备号（itemStorage.user.getDeviceId()）
  getOurDeviceId: () => number | undefined;
  // 已登录的 WebSocket 是否连着；没连着就不发请求，直接提示需要联网
  isConnected: () => boolean;
  // DELETE /v1/devices/{deviceId}；失败要抛出
  removeOurDevice: (deviceId: number) => Promise<void>;
  // 写入 tellomiLoggedOut
  markLoggedOut: () => Promise<void>;
  clearNotifications: () => void;
  // 现有的 unlinkAndDisconnect，完成（进入未连接状态）后 resolve
  unlinkAndDisconnect: () => Promise<void>;
  // 进关联二维码页（'setupAsNewDevice'）
  openRelink: () => void;
  showNeedsNetwork: () => void;
}>;

export async function tellomiLogoutKeepHistory(
  deps: TellomiLogoutKeepHistoryDeps
): Promise<TellomiLogoutKeepHistoryResult> {
  const deviceId = deps.getOurDeviceId();
  if (deviceId == null || deviceId === PRIMARY_DEVICE_ID) {
    log.error(`not a linked device (deviceId=${deviceId}); doing nothing`);
    return 'not-a-linked-device';
  }

  if (!deps.isConnected()) {
    log.warn('not connected; staying linked');
    deps.showNeedsNetwork();
    return 'failed';
  }

  try {
    log.info(`removing device ${deviceId} from the account`);
    await deps.removeOurDevice(deviceId);
  } catch (error) {
    log.warn(
      'server did not remove this device; staying linked',
      Errors.toLogFormat(error)
    );
    deps.showNeedsNetwork();
    return 'failed';
  }

  // 服务器已经删掉本机了，下面每一步出错都不能停在「已关联」的样子。
  try {
    await deps.markLoggedOut();
  } catch (error) {
    log.error(
      'could not persist the logged-out flag; continuing',
      Errors.toLogFormat(error)
    );
  }
  deps.clearNotifications();

  log.info('device removed; unlinking, keeping chats on disk');
  await deps.unlinkAndDisconnect();

  log.info('unlinked; opening the link screen');
  deps.openRelink();
  return 'logged-out';
}
