// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
import { resolve4 as resolve4Cb, resolve6 as resolve6Cb } from 'node:dns';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const resolve4 = promisify(resolve4Cb);
const resolve6 = promisify(resolve6Cb);

// Tellomi (tellomi/tellomi#1687, ADR-0077): the upstream list was Signal's own hosts, which this app never
// connects to, so their IPs were dead weight in every package. Tellomi hosts are not pinned to build-time IPs
// either (the server moves to the mainland, ADR-0077 / docs/ops/CN_MIGRATION_PLAN.md), so the list is empty and
// the generated file is `[]`; the loader (app/dns-fallback.main.ts) already treats that as "no fallback".
/** @type {Array<string>} */
const FALLBACK_DOMAINS = [];

const config = await Promise.all(
  FALLBACK_DOMAINS.sort().map(async domain => {
    const ipv4endpoints = (await resolve4(domain)).map(a => ({
      family: 'ipv4',
      address: a,
    }));

    const ipv6endpoints = (await resolve6(domain)).map(a => ({
      family: 'ipv6',
      address: a,
    }));

    const endpoints = [...ipv4endpoints, ...ipv6endpoints]
      .filter(value => {
        return value != null;
      })
      .sort((a, b) => {
        if (a.family < b.family) {
          return -1;
        }
        if (a.family > b.family) {
          return 1;
        }

        if (a.address < b.address) {
          return -1;
        }
        if (a.address > b.address) {
          return 1;
        }
        return 0;
      });

    return { domain, endpoints };
  })
);

const outPath = join(import.meta.dirname, '..', 'build', 'dns-fallback.json');

await writeFile(outPath, `${JSON.stringify(config, null, 2)}\n`);
