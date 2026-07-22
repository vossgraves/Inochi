import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Crown, Search } from "lucide-react";
import { canManageGuild, discordGuilds, getSession } from "../../lib/auth";
import { DashboardShell } from "../../components/dashboard-shell";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login");
  const guilds = (await discordGuilds(session.accessToken)).filter(canManageGuild).sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name));
  return <DashboardShell>
    <div className="page-heading"><div><div className="eyebrow mono">Workspace / {session.username}</div><h1>Your servers</h1><p>Choose a community where you have Manage Server permission.</p></div><div className="heading-chip"><Search size={14}/>{guilds.length} available</div></div>
    <div className="guild-grid">{guilds.map((guild) => <Link className="guild-card" href={`/dashboard/${guild.id}`} key={guild.id}>
      <div className="guild-card-top">{guild.icon ? <img className="guild-icon" src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`} alt="" /> : <div className="guild-icon">{guild.name.slice(0, 1).toUpperCase()}</div>}<span className={`role-badge ${guild.owner ? "owner" : ""}`}>{guild.owner && <Crown size={11}/>} {guild.owner ? "Owner" : "Manager"}</span></div>
      <div><strong>{guild.name}</strong><span className="guild-id mono">{guild.id}</span></div><ArrowUpRight className="guild-arrow" size={18}/>
    </Link>)}</div>
    {!guilds.length && <div className="empty-state"><strong>No manageable servers found.</strong><p>Discord did not return a server where this account has Manage Server permission.</p></div>}
  </DashboardShell>;
}
