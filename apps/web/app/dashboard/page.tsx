import Link from "next/link";
import { ArrowUpRight, Crown, LogIn, RotateCcw } from "lucide-react";
import { canManageGuild, discordGuilds, getSession } from "../../lib/auth";
import { DashboardShell } from "../../components/dashboard-shell";
import { BrandedEmptyState } from "../../components/branded-empty-state";
import { BrandMark } from "../../components/brand-mark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center px-5 py-16 text-center">
        <div>
          <BrandMark state="paused" className="mx-auto size-16" />
          <span className="mt-8 block font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Signed out
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Connect Discord</h1>
          <p className="mx-auto mt-4 max-w-[52ch] leading-relaxed text-muted-foreground">
            Sign in to see whether Inochi can manage your servers and open their dashboard settings.
          </p>
          <Button asChild variant="primary" size="lg" className="mt-8">
            <Link href="/api/auth/login">
              Sign in with Discord
              <LogIn />
            </Link>
          </Button>
        </div>
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
      <main className="grid min-h-dvh place-items-center px-5 py-16 text-center">
        <div>
          <BrandMark state="error" className="mx-auto size-16" />
          <span className="mt-8 block font-mono text-[0.7rem] tracking-[0.2em] text-destructive-text uppercase">
            Discord unavailable
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Could not load servers
          </h1>
          <p className="mx-auto mt-4 max-w-[54ch] leading-relaxed text-muted-foreground">
            You are signed in as {session.username}, but Discord did not return your server list.
            Retry the request or sign in again.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="primary">
              <Link href="/dashboard">
                Retry
                <RotateCcw />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/api/auth/login">Sign in again</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <DashboardShell>
      <div className="reveal flex flex-wrap items-end justify-between gap-4 border-b border-border pb-8">
        <div>
          <span className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Workspace / {session.username}
          </span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Your servers</h1>
          <p className="mt-3 max-w-[56ch] leading-relaxed text-muted-foreground">
            Choose a community where you have Manage Server permission.
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground tnum">
          {guilds.length} available
        </span>
      </div>

      {/*
        A hairline-divided list rather than tinted cards on a five-colour
        rotation. The server icon is the only colour in the row.
      */}
      {guilds.length > 0 && (
        <ul className="mt-2">
          {guilds.map((guild) => (
            <li key={guild.id} className="reveal border-b border-border">
              <Link
                href={`/dashboard/${guild.id}`}
                className="group flex items-center gap-4 py-5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {guild.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="size-11 shrink-0 rounded-md border border-border object-cover"
                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`}
                    alt=""
                  />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-secondary font-semibold">
                    {guild.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-medium">{guild.name}</strong>
                  <span className="font-mono text-[0.65rem] text-muted-foreground tnum">
                    {guild.id}
                  </span>
                </span>
                {guild.owner && (
                  <Badge variant="warning">
                    <Crown />
                    Owner
                  </Badge>
                )}
                <ArrowUpRight
                  className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-text"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!guilds.length && (
        <div className="mt-10">
          <BrandedEmptyState title="No manageable servers found">
            Discord did not return a server where this account has Manage Server permission.
          </BrandedEmptyState>
        </div>
      )}
    </DashboardShell>
  );
}
