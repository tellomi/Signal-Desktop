// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { HTTPError } from '../types/HTTPError.std.ts';
import type { LinkFirstPartyResult } from './linkSendJob.std.ts';

// ADR-0063 §5.1 rule 2 / §8.1 row 4: what the sender's own lookup of a tell.cc object tells
// rust/links. A group link that is definitely not active is reported as such, so the sender is
// told and no preview goes out.

// The cases the join flow (groups/joinViaLink) calls "revoked": the server refuses the invite
// password (403 without a forbidden reason: the link was reset or turned off) or the group was
// terminated (423). A ban (403 with a reason) says nothing about the link; any other failure may
// work next time, so it only means "no preview".
export function isGroupLinkInactiveError(error: unknown): boolean {
  if (!(error instanceof HTTPError)) {
    return false;
  }
  if (error.code === 423) {
    return true;
  }
  return (
    error.code === 403 && !error.responseHeaders['x-signal-forbidden-reason']
  );
}

export type FirstPartyLookupFound = Readonly<{
  title: string | null;
  memberCount?: number;
  stickerCount?: number;
}>;

function getCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

// `null`: nothing found (no preview); 'inactive': the group link is definitely not active.
export function toLinkFirstPartyResult(
  found: FirstPartyLookupFound | 'inactive' | null
): LinkFirstPartyResult {
  if (found === 'inactive') {
    return { ok: false, invalid: true };
  }
  if (!found) {
    return { ok: false };
  }
  const memberCount = getCount(found.memberCount);
  const stickerCount = getCount(found.stickerCount);
  return {
    ok: true,
    ...(found.title ? { title: found.title } : {}),
    ...(memberCount !== undefined ? { member_count: memberCount } : {}),
    ...(stickerCount !== undefined ? { sticker_count: stickerCount } : {}),
  };
}
