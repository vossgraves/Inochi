import Link from "next/link";
import { ArrowUpRight, Crown, LogIn, RotateCcw, Search } from "lucide-react";
import { canManageGuild, discordGuilds, getSession } from "../../lib/auth";
import { DashboardShell } from "../../components/dashboard-shell";
import { BrandedEmptyState } from "../../components/branded-empty-state";
import { BrandMark } from "../../components/brand-mark";

export default async function Dashboard() {
  const session = await getSession();

  if (!session) {
    return (
      <main className="route-state">
        <div className="route-state-mark">
          <BrandMark state="pending" />
        </div>
        <span className="eyebrow mono">Signed out</span>
        <h1>Connect Discord</h1>
        <p>
          Sign in to see whether Inochi can manage your servers and open their
          dashboard settings.
        </p>
        <Link className="button primary" href="/api/auth/login">
          Sign in with Discord <LogIn size={16} />
        </Link>
      </main>
    );
  }

  let guilds;
  try {
    guilds = (await discordGuilds(session.accessToken))
      .filter(canManageGuild)
      .sort(
        (a, b) =>
          Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name),
      );
  } catch {
    return (
      <main className="route-state route-state-error">
        <div className="route-state-mark">
          <BrandMark state="error" />
        </div>
        <span className="eyebrow mono">Discord unavailable</span>
        <h1>Could not load servers</h1>
        <p>
          You are signed in as {session.username}, but Discord did not return
          your server list. Retry the request or sign in again.
        </p>
        <div className="header-actions">
          <Link className="button primary" href="/dashboard">
            Retry <RotateCcw size={16} />
          </Link>
          <Link className="button ghost" href="/api/auth/login">
            Sign in again
          </Link>
        </div>
      </main>
    );
  }

  return (
    <DashboardShell>
      <div className="page-heading" data-reveal>
        <div>
          <div className="eyebrow mono">Workspace / {session.username}</div>
          <h1>Your <span className="gradient-text">servers</span></h1>
          <p>Choose a community where you have Manage Server permission.</p>
        </div>
        <div className="heading-chip">
          <Search size={14} aria-hidden="true" />
          <span>{guilds.length} available</span>
        </div>
      </div>

      {guilds.length > 0 ? (
        <ul className="guild-grid" role="list">
          {guilds.map((guild, index) => (
            <li key={guild.id}>
              <Link
                className={`guild-card spotlight-card guild-tone-${index % 5}`}
                href={`/dashboard/${guild.id}`}
                data-reveal
              >
                <div className="guild-card-top">
                  {guild.icon ? (
                    <img
                      className="guild-icon"
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`}
                      alt=""
                      width={56}
                      height={56}
                    />
                  ) : (
                    <div className="guild-icon" aria-hidden="true">
                      {guild.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className={`role-badge ${guild.owner ? "owner" : ""}`}>
                    {guild.owner && <Crown size={11} aria-hidden="true" />}
                    {guild.owner ? "Owner" : "Manager"}
                  </span>
                </div>
                <div>
                  <strong>{guild.name}</strong>
                  <span className="guild-id mono">{guild.id}</span>
                </div>
                <ArrowUpRight className="guild-arrow" size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <BrandedEmptyState
          eyebrow="No manager signal"
          title="No manageable servers found"
        >
          Discord did not return a server where this account has Manage Server
          permission.
        </BrandedEmptyState>
      )}
    </DashboardShell>
  );
}
