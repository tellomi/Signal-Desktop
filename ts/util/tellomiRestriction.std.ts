// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

// Tellomi（tellomi/tellomi ADR-0078 §3.4 第三刀）：服务端的人工处置说明。
//
// 服务端在三个地方给出同一个形状 {"tellomiRestriction":{"level","until","appeal","case"}}：发消息被拒的 403、
// 取发送证书被拒的 403、GET /v1/tellomi/restriction 的 200。`until` 是 epoch 秒，`case` 是案件号（老条目可能没有）。
// 这里只做解析和判定，不碰网络、不碰存储（services/tellomiRestriction 管那些）。

export type TellomiRestrictionLevel = 'stranger' | 'all' | 'suspended';

export type TellomiRestriction = Readonly<{
  level: TellomiRestrictionLevel;
  // 截止时间（毫秒）
  until: number;
  appeal: string;
  caseId?: string;
}>;

const LEVELS: ReadonlySet<string> = new Set(['stranger', 'all', 'suspended']);
const APPEAL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CASE_ID = /^[0-9A-Za-z._-]{1,64}$/;

// body 里没有可用的 tellomiRestriction 就是 undefined（老服务端、别的 403、字段不对）。
export function parseTellomiRestriction(
  body: unknown
): TellomiRestriction | undefined {
  if (body == null || typeof body !== 'object') {
    return undefined;
  }
  const raw = (body as { tellomiRestriction?: unknown }).tellomiRestriction;
  if (raw == null || typeof raw !== 'object') {
    return undefined;
  }
  const { level, until, appeal } = raw as Record<string, unknown>;
  const caseId = (raw as Record<string, unknown>).case;
  if (typeof level !== 'string' || !LEVELS.has(level)) {
    return undefined;
  }
  if (typeof until !== 'number' || !Number.isFinite(until) || until <= 0) {
    return undefined;
  }
  if (typeof appeal !== 'string' || !APPEAL.test(appeal)) {
    return undefined;
  }
  return {
    level: level as TellomiRestrictionLevel,
    until: until * 1000,
    appeal,
    ...(typeof caseId === 'string' && CASE_ID.test(caseId) ? { caseId } : {}),
  };
}

export function isTellomiRestrictionActive(
  restriction: TellomiRestriction | undefined,
  now: number
): restriction is TellomiRestriction {
  return restriction != null && restriction.until > now;
}

// 失败的发送里带着的 HTTPError（UnauthorizedMessageSendError 的 cause、OutgoingMessageError 的 error）上的处置说明。
export function tellomiRestrictionFromSendError(
  error: unknown
): TellomiRestriction | undefined {
  for (const candidate of [
    (error as { cause?: unknown } | undefined)?.cause,
    (error as { error?: unknown } | undefined)?.error,
    error,
  ]) {
    const response = (candidate as { response?: unknown } | undefined)
      ?.response;
    const restriction = parseTellomiRestriction(response);
    if (restriction) {
      return restriction;
    }
  }
  return undefined;
}

// 左栏横幅的两句：正文键 + 申诉句键（有案件号用带编号的那句）。suspended 在电脑端用不到（账号登不上），给 all 的正文兜底。
export function tellomiRestrictionMessageKeys(
  restriction: TellomiRestriction
): {
  body: 'icu:TellomiRestriction__stranger' | 'icu:TellomiRestriction__all';
  appeal:
    | 'icu:TellomiRestriction__appeal--case'
    | 'icu:TellomiRestriction__appeal';
} {
  return {
    body:
      restriction.level === 'stranger'
        ? 'icu:TellomiRestriction__stranger'
        : 'icu:TellomiRestriction__all',
    appeal: restriction.caseId
      ? 'icu:TellomiRestriction__appeal--case'
      : 'icu:TellomiRestriction__appeal',
  };
}
