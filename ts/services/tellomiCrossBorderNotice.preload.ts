// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import * as Errors from '../types/errors.std.ts';
import { createLogger } from '../logging/log.std.ts';
import { isTestOrMockEnvironment } from '../environment.std.ts';
import { DataReader } from '../sql/Client.preload.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { preconnectChat } from '../textsecure/preconnect.preload.ts';
import { showTellomiCrossBorderNotice } from '../shims/showTellomiCrossBorderNotice.dom.tsx';
import { createTellomiCrossBorderNoticeGate } from '../util/tellomiCrossBorderNotice.std.ts';

const log = createLogger('tellomiCrossBorderNotice');

// Tellomi（tellomi/tellomi#1338）：Desktop 的跨境告知闸门（只读版，逻辑见 util/tellomiCrossBorderNotice.std.ts）。
// 本机确认过的版本记在 itemStorage 的 tellomiCrossBorderNoticeVersion：删除全部数据会清掉；解除关联也会清掉
// （StorageKeys 里归入 REMOVE_AFTER_UNLINK），所以重新关联前会再出一次（需求说明 6.1 ④「首次打开 / 重新关联时」）。
const gate = createTellomiCrossBorderNoticeGate({
  shouldSkip: isTestOrMockEnvironment,
  getStoredVersion: () => itemStorage.get('tellomiCrossBorderNoticeVersion'),
  storeVersion: version =>
    itemStorage.put('tellomiCrossBorderNoticeVersion', version),
  showNotice: showTellomiCrossBorderNotice,
  onNetworkAllowed: () => {
    log.info('network allowed');
    preconnectChat();
    window.IPC.tellomiNetworkAllowed();
  },
});

// startApp 一开始调（itemStorage 还没就绪，直接读数据库）：本机已确认过当前版本 → 照上游尽早预连接、让主进程放开
// 自动更新和可选资源下载；没确认过就什么都不做，等 onready 里的 ensureTellomiCrossBorderNoticeAcknowledged。
export async function allowNetworkIfTellomiCrossBorderNoticeAcknowledged(): Promise<void> {
  try {
    const item = await DataReader.getItemById(
      'tellomiCrossBorderNoticeVersion'
    );
    gate.allowNetworkIfAcknowledged(item?.value);
  } catch (error) {
    log.warn('early check failed', Errors.toLogFormat(error));
  }
}

// 所有会主动联网的入口先 await 它（需要 itemStorage 已就绪）
export function ensureTellomiCrossBorderNoticeAcknowledged(): Promise<void> {
  return gate.ensureAcknowledged();
}
