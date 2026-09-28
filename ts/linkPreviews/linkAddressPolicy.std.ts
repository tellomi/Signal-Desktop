// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// ADR-0063 §6.2 (SSRF): addresses a link-preview fetch must never connect to. Checked on every
// hop, on what DNS actually returned. Not blocked on purpose: 198.18.0.0/15, where fake-ip
// proxies (Clash, Surge, sing-box) resolve every name — blocking it would turn every preview into
// a brand shell for those users.

function parseIPv4(address: string): Array<number> | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  const bytes = parts.map(part =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN
  );
  return bytes.every(byte => byte >= 0 && byte <= 255) ? bytes : undefined;
}

function isBlockedIPv4([a = 0, b = 0]: ReadonlyArray<number>): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT, Tailscale)
    a === 127 || // 127.0.0.0/8
    (a === 169 && b === 254) || // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a >= 224 // multicast and reserved, as upstream
  );
}

// Expands an IPv6 address (an embedded IPv4 tail allowed) to eight 16-bit groups.
function parseIPv6(address: string): Array<number> | undefined {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) {
    text = text.slice(0, zone);
  }
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) {
    return undefined;
  }
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (!v4) {
      return undefined;
    }
    const high = (v4[0] ?? 0) * 256 + (v4[1] ?? 0);
    const low = (v4[2] ?? 0) * 256 + (v4[3] ?? 0);
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  const toGroups = (part: string): Array<number> | undefined => {
    if (part === '') {
      return [];
    }
    const groups = part
      .split(':')
      .map(group =>
        /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN
      );
    return groups.every(group => !Number.isNaN(group)) ? groups : undefined;
  };
  const head = toGroups(halves[0] ?? '');
  const rest = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  if (!head || !rest) {
    return undefined;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }
  const missing = 8 - head.length - rest.length;
  if (missing < 1) {
    return undefined;
  }
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function isBlockedIPv6(groups: ReadonlyArray<number>): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  const embeddedV4 = [
    Math.floor(g6 / 256),
    g6 % 256,
    Math.floor(g7 / 256),
    g7 % 256,
  ];
  const allZero = (values: ReadonlyArray<number>) =>
    values.every(value => value === 0);

  if (allZero([g0, g1, g2, g3, g4, g5, g6]) && (g7 === 0 || g7 === 1)) {
    return true; // :: (unspecified) and ::1 (loopback)
  }
  if (allZero([g0, g1, g2, g3, g4]) && g5 === 0xffff) {
    return isBlockedIPv4(embeddedV4); // IPv4-mapped ::ffff:a.b.c.d
  }
  if (g0 === 0x64 && g1 === 0xff9b && allZero([g2, g3, g4, g5])) {
    return isBlockedIPv4(embeddedV4); // NAT64 64:ff9b::a.b.c.d
  }
  return (
    (g0 >= 0xfc00 && g0 <= 0xfdff) || // fc00::/7 (unique local)
    (g0 >= 0xfe80 && g0 <= 0xfebf) || // fe80::/10 (link local)
    (g0 >= 0xfec0 && g0 <= 0xfeff) || // fec0::/10 (site local, deprecated)
    g0 >= 0xff00 // multicast
  );
}

// Unparseable input counts as blocked: the fetcher only ever connects to what it checked.
export function isBlockedLinkAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) {
    return isBlockedIPv4(v4);
  }
  const v6 = parseIPv6(address.replace(/^\[|\]$/g, ''));
  if (v6) {
    return isBlockedIPv6(v6);
  }
  return true;
}
