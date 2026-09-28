// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0063 §4.3: hosts that failed at the network layer (DNS, TCP, TLS) on the current network are
// skipped by later previews. Memory only — never stored, never reported — and forgotten after
// 30 minutes or when the network changes.

const TTL_MS = 30 * 60 * 1000;

const unreachable = new Map<string, number>();

export function getUnreachableLinkHosts(now: number): Array<string> {
  const hosts: Array<string> = [];
  for (const [host, expiresAt] of unreachable) {
    if (expiresAt <= now) {
      unreachable.delete(host);
    } else {
      hosts.push(host);
    }
  }
  return hosts;
}

export function rememberUnreachableLinkHosts(
  hosts: ReadonlyArray<string>,
  now: number
): void {
  for (const host of hosts) {
    unreachable.set(host, now + TTL_MS);
  }
}

export function forgetUnreachableLinkHosts(): void {
  unreachable.clear();
}
