import { levelForXp, xpForLevel } from "@inochi/core";
import type { LeaderboardPageDto, LeaderboardScope } from "@inochi/api-contract";
import { and, db, desc, eq, getLeaderboard, gt, gte, members } from "@inochi/database";
import { apiJson, authorizedGuild, memberDto, parsePage } from "./api";

export async function leaderboardResponse(request: Request, guildId: string, scope: LeaderboardScope) {
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  const page = parsePage(request);
  if ("error" in page) return page.error;
  const maximum = loaded.guild.settings.leaderboard.maxEntries || Number.MAX_SAFE_INTEGER;
  const effectiveLimit = Math.max(0, Math.min(page.limit, maximum - page.offset));
  const minimumXp = xpForLevel(loaded.guild.settings.leaderboard.minLevel, loaded.guild.settings);
  const fetchLimit = Math.min(effectiveLimit + 1, maximum - page.offset);
  const fetched = effectiveLimit === 0
    ? []
    : scope === "total"
      ? await getLeaderboard(db, guildId, fetchLimit, page.offset, { minimumXp, maximumEntries: maximum })
      : await db.select().from(members).where(and(eq(members.guildId, guildId), eq(members.hidden, false), gt(members.weeklyXp, 0), minimumXp > 0 ? gte(members.xp, minimumXp) : undefined))
        .orderBy(desc(members.weeklyXp), members.userId).limit(fetchLimit).offset(page.offset);
  const hasNext = fetched.length > effectiveLimit;
  const rows = fetched.slice(0, effectiveLimit);
  const body: LeaderboardPageDto = {
    scope,
    members: rows.map((member, index) => ({
      ...memberDto(member, loaded.guild.settings),
      rank: page.offset + index + 1,
      score: scope === "total" ? member.xp : member.weeklyXp,
    })),
    nextCursor: hasNext ? page.nextCursor : null,
  };
  return apiJson(body);
}
