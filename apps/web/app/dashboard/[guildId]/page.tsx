import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getOrCreateGuild } from "@inochi/database";
import { requireGuildManager } from "../../../lib/auth";
import { SettingsForm } from "../../../components/settings-form";

export default async function GuildDashboard({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildManager(guildId);
  if (!access) redirect("/dashboard");
  const row = await getOrCreateGuild((await import("@inochi/database")).db, guildId, access.guild.name);
  return <div className="dashboard-layout">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand mono"><span className="brand-dot" />Inochi</Link>
      <nav>
        <a className="nav-link active" href="#xp">XP gain</a><a className="nav-link" href="#curve">Level curve</a><a className="nav-link" href="#level-up">Level up</a>
        <a className="nav-link" href="#rank">Rank card</a><a className="nav-link" href="#leaderboard">Leaderboard</a><a className="nav-link" href="#games">Games</a>
        <a className="nav-link" href="#roles">Rewards</a><a className="nav-link" href="#imports">Imports</a>
      </nav>
    </aside>
    <main className="dashboard-main">
      <div className="page-heading"><div><div className="eyebrow mono">Server / {guildId}</div><h1>{access.guild.name}</h1><p>One configuration shared by the dashboard and Discord worker.</p></div><Link className="button" href={`/leaderboard/${guildId}`} target="_blank">Leaderboard <ExternalLink size={14} /></Link></div>
      <SettingsForm guildId={guildId} initial={row.settings} />
    </main>
  </div>;
}
