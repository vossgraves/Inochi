import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { levelForXp, xpForLevel } from "@inochi/core";
import { db, getGuild, getLeaderboard, inArray, rankProfiles } from "@inochi/database";
import { discordGuilds, getSession, requireGuildManager } from "../../../lib/auth";

export default async function Leaderboard({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const guild = await getGuild(db, guildId);
  if (!guild || !guild.settings.enabled || !guild.settings.leaderboard.enabled) notFound();
  if (guild.settings.leaderboard.visibility === "managers" && !await requireGuildManager(guildId)) notFound();
  if (guild.settings.leaderboard.visibility === "members") {
    const session = await getSession();
    if (!session || !(await discordGuilds(session.accessToken)).some((item) => item.id === guildId)) notFound();
  }
  const rows = await getLeaderboard(db, guildId, 100, 0, { minimumXp: xpForLevel(guild.settings.leaderboard.minLevel, guild.settings), maximumEntries: guild.settings.leaderboard.maxEntries });
  const privateIds = guild.settings.leaderboard.visibility === "public" && rows.length
    ? new Set((await db.select().from(rankProfiles).where(inArray(rankProfiles.userId, rows.map((row) => row.userId)))).filter((profile) => profile.leaderboardPrivate).map((profile) => profile.userId))
    : new Set<string>();
  return <main className="shell leaderboard-shell">
    <Link className="text-link" href="/"><ArrowLeft size={14}/>Inochi</Link>
    <div className="page-heading"><div><div className="eyebrow mono">Public progression / {guildId}</div><h1>{guild.name ?? "Server ranks"}</h1><p>{rows.length} ranked member{rows.length === 1 ? "" : "s"} shown</p></div></div>
    {rows.length ? <section className="leaderboard-list">
      <header className="leaderboard-head"><span>Rank</span><span>Member</span><span>Level / Total XP</span></header>
      {rows.map((member, index) => <div className="leaderboard-row" key={member.userId}><span className="leaderboard-position">{String(index + 1).padStart(2, "0")}</span><span className="leaderboard-member">{privateIds.has(member.userId) ? "Private member" : member.userId}</span><strong className="leaderboard-value">Level {levelForXp(member.xp, guild.settings)}<small>{member.xp.toLocaleString()} XP</small></strong></div>)}
    </section> : <div className="empty-state"><strong>No ranked members yet.</strong><p>The first eligible message will start this leaderboard.</p></div>}
  </main>;
}
