// Copyright 2026 Tellomi
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi (ADR-0065 §6.5, tellomi/tellomi#1054): the probe behind RegionSelector - a TCP + TLS
// handshake to a region's chat endpoint, timed. No request is sent and no account is needed, so
// it also works before registration. Certificates are checked against the same roots the app
// trusts (`certificateAuthority`), so a poisoned DNS answer cannot pass as a healthy region.

import { connect } from 'node:tls';
import type { LookupFunction } from 'node:net';

import type {
  RegionProbeResultType,
  RegionProbeType,
} from './tellomiRegion.std.ts';

export type ChatProbeOptionsType = Readonly<{
  timeoutMs: number;
  // PEM bundle; omitted = the platform trust store.
  certificateAuthority?: string;
  // Replaces the DNS lookup; tests and scripts use it to record every name that gets resolved.
  lookup?: LookupFunction;
}>;

function probeChatEndpoint(
  serverUrl: string,
  { timeoutMs, certificateAuthority, lookup }: ChatProbeOptionsType
): Promise<RegionProbeResultType> {
  const { hostname, port } = new URL(serverUrl);
  const startedAt = performance.now();

  return new Promise(resolve => {
    const socket = connect({
      host: hostname,
      port: port ? Number(port) : 443,
      servername: hostname,
      ca: certificateAuthority,
      lookup,
      ALPNProtocols: ['http/1.1'],
    });
    const finish = (result: RegionProbeResultType) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }),
      timeoutMs
    );
    socket.once('secureConnect', () =>
      finish({ ok: true, rttMs: performance.now() - startedAt })
    );
    socket.once('error', error => finish({ ok: false, error: error.message }));
  });
}

export function createChatProbe(
  options: ChatProbeOptionsType
): RegionProbeType {
  return (_id, endpoints) => probeChatEndpoint(endpoints.serverUrl, options);
}
