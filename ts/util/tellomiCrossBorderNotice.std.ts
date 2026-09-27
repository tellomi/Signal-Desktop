// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import * as Errors from '../types/errors.std.ts';
import { createLogger } from '../logging/log.std.ts';
import { explodePromise } from './explodePromise.std.ts';

const log = createLogger('tellomiCrossBorderNotice');

// Tellomi（tellomi/tellomi#1338）：个人信息跨境传输告知的 Desktop 只读版（需求说明
// docs/product/specs/privacy-compliance-hk-cross-border.md 第六节 ④、6.3）。
// Desktop 在 Tellomi 里永远是关联设备：跨境的单独同意在手机上取得，这里只出同一份告知 + 一个「知道了」，
// 点了在本机记下告知版本，之后才放开联网（关联用的 provisioning 连接、已关联设备的鉴权连接、自动更新、可选资源下载）。

// 告知版本独立于隐私政策版本（第 21.7 节：只有实质变化才重新告知）；改这里 = 所有设备再挡一次。
// 要和 docs/legal/manifest.json 的 notices.cross-border、iOS / Android 的常量一起改。
export const TELLOMI_CROSS_BORDER_NOTICE_VERSION = 'cb-1';

export const TELLOMI_PRIVACY_POLICY_URL =
  'https://www.tellomi.app/legal/privacy/';
export const TELLOMI_THIRD_PARTY_LIST_URL =
  'https://www.tellomi.app/legal/third-party/';

// 渲染进程告诉主进程「可以联网了」用的 IPC 频道（主进程据此放开自动更新和可选资源下载）
export const TELLOMI_NETWORK_ALLOWED_CHANNEL =
  'tellomi-cross-border-notice:network-allowed';

export function isTellomiCrossBorderNoticeAcknowledged(
  storedVersion: unknown
): boolean {
  return storedVersion === TELLOMI_CROSS_BORDER_NOTICE_VERSION;
}

export type TellomiCrossBorderNoticeGateOptions = Readonly<{
  // 测试 / mock 环境不出告知（test-mock 的自动化关联流程不会点「知道了」）；调用时才判断，环境在 preload 里才设好
  shouldSkip: () => boolean;
  getStoredVersion: () => string | undefined;
  storeVersion: (version: string) => Promise<void>;
  // 显示告知页，用户点「知道了」后 resolve
  showNotice: () => Promise<void>;
  // 每个进程只调一次：预连接、通知主进程
  onNetworkAllowed: () => void;
}>;

export type TellomiCrossBorderNoticeGate = Readonly<{
  // 启动早期（itemStorage 还没就绪）按直接从数据库读到的版本判断：已确认过就照上游尽早放开联网；否则什么都不做
  allowNetworkIfAcknowledged: (storedVersion: unknown) => boolean;
  // 所有会主动联网的入口先 await 它：已确认过立即 resolve；没确认过就出告知，点「知道了」后记版本、放开联网
  ensureAcknowledged: () => Promise<void>;
  isNetworkAllowed: () => boolean;
}>;

export function createTellomiCrossBorderNoticeGate(
  options: TellomiCrossBorderNoticeGateOptions
): TellomiCrossBorderNoticeGate {
  let networkAllowed = false;
  let pending: Promise<void> | undefined;

  function allowNetwork(): void {
    if (networkAllowed) {
      return;
    }
    networkAllowed = true;
    options.onNetworkAllowed();
  }

  async function showAndStore(): Promise<void> {
    try {
      log.info('showing the notice');
      await options.showNotice();
      log.info('acknowledged');
      try {
        await options.storeVersion(TELLOMI_CROSS_BORDER_NOTICE_VERSION);
      } catch (error) {
        // 记不下来只会让下次启动再出一次，不能因此卡住已经点过「知道了」的这次启动
        log.error('failed to store the version', Errors.toLogFormat(error));
      }
    } finally {
      pending = undefined;
    }
    allowNetwork();
  }

  return {
    allowNetworkIfAcknowledged(storedVersion) {
      if (
        options.shouldSkip() ||
        isTellomiCrossBorderNoticeAcknowledged(storedVersion)
      ) {
        allowNetwork();
        return true;
      }
      return false;
    },
    async ensureAcknowledged() {
      if (
        options.shouldSkip() ||
        isTellomiCrossBorderNoticeAcknowledged(options.getStoredVersion())
      ) {
        allowNetwork();
        return;
      }
      // 启动和「设为新设备」可能同时走到这里：共用同一页告知
      pending ??= showAndStore();
      await pending;
    },
    isNetworkAllowed: () => networkAllowed,
  };
}

export type TellomiNetworkLatch = Readonly<{
  open: () => void;
  isOpen: () => boolean;
  wait: () => Promise<void>;
}>;

// 主进程用：渲染进程报「可以联网了」之前，自动更新和可选资源下载在这里等着（不失败、不重试）
export function createTellomiNetworkLatch(): TellomiNetworkLatch {
  const { promise, resolve } = explodePromise<void>();
  let isOpen = false;
  return {
    open() {
      if (isOpen) {
        return;
      }
      isOpen = true;
      resolve();
    },
    isOpen: () => isOpen,
    wait: () => promise,
  };
}
