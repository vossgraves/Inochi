import { NextResponse } from "next/server";
import { levelForXp, xpForLevel } from "@inochi/core";
import { db, getLeaderboard, getOrCreateGuild } from "@inochi/database";
import { authenticateApi } from "../../../../../lib/api-auth";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  if (!await authenticateApi(request, guildId)) return NextResponse.json({ error: "Unauthorized or rate limited" }, { status: 401 });
  const guild = await getOrCreateGuild(db, guildId);
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rows = await getLeaderboard(db, guildId, limit, offset, { minimumXp: xpForLevel(guild.settings.leaderboard.minLevel, guild.settings), maximumEntries: guild.settings.leaderboard.maxEntries });
  return NextResponse.json({ members: rows.map((row, index) => ({ userId: row.userId, xp: row.xp, level: levelForXp(row.xp, guild.settings), rank: offset + index + 1, messageCount: row.messageCount })) });
}
