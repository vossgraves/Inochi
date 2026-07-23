import { xpForLevel } from "@inochi/core";
import type { MemberRankDto } from "@inochi/api-contract";
import { and, eq, gt, gte, lt, members, or, sql } from "@inochi/database";
import { apiError, apiJson, authorizedGuild, db, parseScope, snowflakePattern } from "../../../../../_lib/api";

export async function GET(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  const { guildId, userId } = await context.params;
  if (!snowflakePattern.test(userId)) return apiError(400, "bad_request", "userId must be a Discord snowflake");
  const scope = parseScope(new URL(request.url).searchParams.get("scope"));
  if (!scope) return apiError(400, "bad_request", "scope must be total or weekly");
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  const member = await db.query.members.findFirst({ where: and(eq(members.guildId, guildId), eq(members.userId, userId)) });
  const score = member ? (scope === "total" ? member.xp : member.weeklyXp) : 0;
  const minimumXp = xpForLevel(loaded.guild.settings.leaderboard.minLevel, loaded.guild.settings);
  if (!member || member.hidden || score <= 0 || member.xp < minimumXp) return apiError(404, "not_found", "Member is not ranked");
  const scoreColumn = scope === "total" ? members.xp : members.weeklyXp;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(members).where(and(
    eq(members.guildId, guildId),
    eq(members.hidden, false),
    gte(members.xp, minimumXp),
    or(gt(scoreColumn, score), and(eq(scoreColumn, score), lt(members.userId, userId))),
  ));
  const rank = (row?.count ?? 0) + 1;
  const maximum = loaded.guild.settings.leaderboard.maxEntries;
  if (maximum > 0 && rank > maximum) return apiError(404, "not_found", "Member is outside the ranked leaderboard");
  const body: MemberRankDto = { scope, userId, rank, score };
  return apiJson(body);
}
