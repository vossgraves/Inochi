import { notFound } from "next/navigation";
import { levelForXp, xpForLevel } from "@inochi/core";
import { db, getLeaderboard, getOrCreateGuild, inArray, rankProfiles } from "@inochi/database";
import { discordGuilds, getSession, requireGuildManager } from "../../../lib/auth";

export default async function Leaderboard({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const guild = await getOrCreateGuild(db, guildId);
  if (!guild.settings.enabled || !guild.settings.leaderboard.enabled) notFound();
  if (guild.settings.leaderboard.visibility === "managers" && !await requireGuildManager(guildId)) notFound();
  if (guild.settings.leaderboard.visibility === "members") {
    const session = await getSession();
    if (!session || !(await discordGuilds(session.accessToken)).some((item) => item.id === guildId)) notFound();
  }
  const rows = await getLeaderboard(db, guildId, 100, 0, { minimumXp: xpForLevel(guild.settings.leaderboard.minLevel, guild.settings), maximumEntries: guild.settings.leaderboard.maxEntries });
  const privateIds = guild.settings.leaderboard.visibility === "public" && rows.length
    ? new Set((await db.select().from(rankProfiles).where(inArray(rankProfiles.userId, rows.map((row) => row.userId)))).filter((profile) => profile.leaderboardPrivate).map((profile) => profile.userId))
    : new Set<string>();
  return <main className="shell" style={{ padding: "5rem 0" }}>
    <div className="eyebrow mono">Inochi / leaderboard</div>
    <div className="page-heading"><div><h1 style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>{guild.name ?? "Server ranks"}</h1><p>{rows.length} ranked members shown</p></div></div>
    <section className="section">
      <header className="section-head"><h2 className="mono">Rank / member</h2><span className="status">LEVEL / TOTAL XP</span></header>
      <div>{rows.map((member, index) => <div key={member.userId} style={{ display: "grid", gridTemplateColumns: "4rem 1fr auto", gap: "1rem", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}><span className="mono" style={{ color: "#777" }}>{String(index + 1).padStart(2, "0")}</span><span>{privateIds.has(member.userId) ? "Private member" : member.userId}</span><strong>Lv. {levelForXp(member.xp, guild.settings)} / {member.xp.toLocaleString()} XP</strong></div>)}</div>
    </section>
  </main>;
}
