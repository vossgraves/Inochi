import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getOrCreateGuild } from "@inochi/database";
import { analyzeCurve } from "@inochi/core";
import { requireGuildManager } from "../../../lib/auth";
import { SettingsForm } from "../../../components/settings-form";
import { DashboardShell } from "../../../components/dashboard-shell";

const nav = [
  { href: "#overview", label: "Overview" }, { href: "#xp", label: "XP earning" }, { href: "#curve", label: "Level curve" },
  { href: "#level-up", label: "Announcements" }, { href: "#rank", label: "Rank card" }, { href: "#leaderboard", label: "Leaderboard" },
  { href: "#games", label: "Games" }, { href: "#roles", label: "Roles & community" }, { href: "#logging", label: "Logs & automation" }, { href: "#imports", label: "Data & backups" },
];

export default async function GuildDashboard({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildManager(guildId);
  if (!access) redirect("/dashboard");
  const row = await getOrCreateGuild((await import("@inochi/database")).db, guildId, access.guild.name);
  const curve = analyzeCurve(row.settings);
  return <DashboardShell guildName={access.guild.name} nav={nav}>
    <div className="page-heading"><div><div className="eyebrow mono">Server control / {guildId}</div><h1>{access.guild.name}</h1><p>One configuration shared by the dashboard, Discord worker, and public API.</p></div><Link className="button" href={`/leaderboard/${guildId}`} target="_blank">Leaderboard <ExternalLink size={14} /></Link></div>
    <section className="overview-panel" id="overview">
      <div className="overview-primary"><span className="mono">System state</span><strong>{row.settings.enabled ? "Earning XP" : "Paused"}</strong><p>{row.settings.enabled ? `${row.settings.gain.min}–${row.settings.gain.max} XP every ${row.settings.gain.cooldownSeconds}s` : "Enable XP below when you are ready."}</p></div>
      <div className="overview-stats"><div><span>Curve</span><strong>{curve.strictlyIncreasing ? "Healthy" : "Review"}</strong></div><div><span>Rewards</span><strong>{row.settings.rewards.length}</strong></div><div><span>Games</span><strong>{row.settings.games.rotation.enabled ? "Auto" : "Manual"}</strong></div><div><span>Visibility</span><strong>{row.settings.leaderboard.visibility}</strong></div></div>
    </section>
    {!row.setupCompletedAt && <div className="notice warning">This server has not completed guided setup. <Link href={`/dashboard/${guildId}/setup`}>Open the setup wizard</Link> before enabling XP.</div>}
    <SettingsForm guildId={guildId} initial={row.settings} initialRevision={row.settingsRevision} />
  </DashboardShell>;
}
