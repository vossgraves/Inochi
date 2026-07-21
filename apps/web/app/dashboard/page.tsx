import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, LogOut } from "lucide-react";
import { canManageGuild, discordGuilds, getSession } from "../../lib/auth";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login");
  const guilds = (await discordGuilds(session.accessToken)).filter(canManageGuild);
  return <div className="dashboard-layout">
    <aside className="sidebar">
      <div className="brand mono"><span className="brand-dot" />Inochi</div>
      <nav><Link className="nav-link active" href="/dashboard">Servers</Link><Link className="nav-link" href="/">Home</Link></nav>
      <form action="/api/auth/logout" method="post" style={{ position: "absolute", bottom: "1.5rem", left: "1.5rem" }}><button type="submit"><LogOut size={14} /> Sign out</button></form>
    </aside>
    <main className="dashboard-main">
      <div className="page-heading"><div><div className="eyebrow mono">Workspace / {session.username}</div><h1>Select a server.</h1><p>Servers where you have Manage Server permission.</p></div></div>
      <div className="guild-grid">
        {guilds.map((guild) => <Link className="card guild-card" href={`/dashboard/${guild.id}`} key={guild.id}>
          <div className="guild-icon">{guild.name.slice(0, 1).toUpperCase()}</div>
          <div><strong>{guild.name}</strong><div className="status" style={{ marginTop: ".45rem" }}>{guild.owner ? "OWNER" : "MANAGER"}</div></div>
          <ArrowUpRight size={17} />
        </Link>)}
      </div>
      {!guilds.length && <div className="card">No manageable servers were returned by Discord.</div>}
    </main>
  </div>;
}
