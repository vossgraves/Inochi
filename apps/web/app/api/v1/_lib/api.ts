import { randomUUID } from "node:crypto";
import { levelForXp } from "@inochi/core";
import type { ApiErrorCode, LeaderboardScope, MemberDto } from "@inochi/api-contract";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_PAGINATION_OFFSET } from "@inochi/api-contract";
import { db, getGuild, members } from "@inochi/database";
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "../../../../lib/api-auth";

export const snowflakePattern = /^\d{16,20}$/;

export function apiError(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>, headers?: HeadersInit) {
  const requestId = randomUUID();
  return NextResponse.json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId, ...headers } });
}

export function apiJson<T>(body: T, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "private, no-store", ...init.headers } });
}

export async function authorize(request: Request, guildId: string) {
  const result = await authenticateApiRequest(request, guildId);
  if (result.authenticated) return null;
  if (result.reason === "rate_limited") return apiError(429, "rate_limited", "API rate limit exceeded", undefined, { "retry-after": String(result.retryAfterSeconds) });
  return apiError(401, "unauthorized", "A valid API key with access to this guild is required");
}

export async function authorizedGuild(request: Request, guildId: string) {
  if (!snowflakePattern.test(guildId)) return { response: apiError(400, "bad_request", "guildId must be a Discord snowflake") } as const;
  const denied = await authorize(request, guildId);
  if (denied) return { response: denied } as const;
  const guild = await getGuild(db, guildId);
  if (!guild) return { response: apiError(404, "not_found", "Guild not found") } as const;
  return { guild } as const;
}

export function memberDto(member: typeof members.$inferSelect, settings: Parameters<typeof levelForXp>[1]): MemberDto {
  return {
    userId: member.userId,
    xp: member.xp,
    weeklyXp: member.weeklyXp,
    level: levelForXp(member.xp, settings),
    messageCount: member.messageCount,
    updatedAt: member.updatedAt.toISOString(),
  };
}

export function parseScope(value: string | null): LeaderboardScope | null {
  return value === null || value === "total" ? "total" : value === "weekly" ? "weekly" : null;
}

export function parsePage(request: Request) {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) return { error: apiError(400, "bad_request", `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`) } as const;
  const cursor = url.searchParams.get("cursor");
  let offset = 0;
  if (cursor) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!decoded || typeof decoded !== "object" || !Number.isInteger((decoded as { offset?: unknown }).offset)) throw new Error();
      offset = (decoded as { offset: number }).offset;
    } catch {
      return { error: apiError(400, "bad_request", "cursor is invalid") } as const;
    }
  }
  if (offset < 0 || offset >= MAX_PAGINATION_OFFSET) return { error: apiError(400, "bad_request", "cursor is outside the pagination window") } as const;
  const nextCursor = offset + limit < MAX_PAGINATION_OFFSET ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString("base64url") : null;
  return { limit, offset, nextCursor } as const;
}

export { db };
