import { NextResponse } from "next/server";
import { db, getLeaderboard, getOrCreateGuild, inArray, rankProfiles } from "@inochi/database";
import { levelForXp, xpForLevel } from "@inochi/core";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const guild = await getOrCreateGuild(db, guildId);
  if (!guild.settings.enabled || !guild.settings.leaderboard.enabled || guild.settings.leaderboard.visibility !== "public") return NextResponse.json({ error: "Leaderboard unavailable" }, { status: 404 });
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
  const rows = await getLeaderboard(db, guildId, 50, (page - 1) * 50, { minimumXp: xpForLevel(guild.settings.leaderboard.minLevel, guild.settings), maximumEntries: guild.settings.leaderboard.maxEntries });
  const privateIds = rows.length ? new Set((await db.select().from(rankProfiles).where(inArray(rankProfiles.userId, rows.map((row) => row.userId)))).filter((profile) => profile.leaderboardPrivate).map((profile) => profile.userId)) : new Set<string>();
  return NextResponse.json({ page, members: rows.map((member, index) => ({ ...member, userId: privateIds.has(member.userId) ? null : member.userId, private: privateIds.has(member.userId), rank: (page - 1) * 50 + index + 1, level: levelForXp(member.xp, guild.settings) })) });
}
