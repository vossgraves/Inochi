import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { levelForXp, xpForLevel } from "@inochi/core";
import { db, getGuild, getLeaderboard, inArray, rankProfiles } from "@inochi/database";
import { discordGuilds, getSession, requireGuildManager } from "../../../lib/auth";
import { ThemeToggle } from "../../../components/theme-toggle";

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

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-[54rem] items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-mono text-xs tracking-wider uppercase transition-colors hover:text-primary-text"
          >
            <ArrowLeft className="size-4" />
            Inochi
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[54rem] px-5 pt-14 pb-24">
        <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase tnum">
          Public progression / {guildId}
        </p>
        <h1 className="mt-5 text-4xl font-bold tracking-tight break-words sm:text-5xl">
          {guild.name ?? "Server ranks"}
        </h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground tnum">
          {rows.length} ranked member{rows.length === 1 ? "" : "s"} shown
        </p>

        {rows.length ? (
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  <th scope="col" className="w-16 py-3 font-normal">Rank</th>
                  <th scope="col" className="py-3 font-normal">Member</th>
                  <th scope="col" className="w-24 py-3 text-right font-normal">Level</th>
                  <th scope="col" className="w-36 py-3 text-right font-normal">Total XP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member, index) => (
                  <tr key={member.userId} className="border-b border-border/60">
                    <td className="py-4 font-mono text-sm text-primary-text tnum">
                      {String(index + 1).padStart(2, "0")}
                    </td>
                    <td className="py-4 font-mono text-sm break-all">
                      {privateIds.has(member.userId) ? (
                        <span className="text-muted-foreground italic">Private member</span>
                      ) : (
                        member.userId
                      )}
                    </td>
                    <td className="py-4 text-right font-mono text-sm tnum">
                      {levelForXp(member.xp, guild.settings)}
                    </td>
                    <td className="py-4 text-right font-mono text-sm text-muted-foreground tnum">
                      {member.xp.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-12 border border-dashed border-border-strong px-6 py-16 text-center">
            <strong className="text-lg font-semibold">No ranked members yet.</strong>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              The first eligible message will start this leaderboard.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
