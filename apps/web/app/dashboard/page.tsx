import Link from "next/link";
import { ArrowUpRight, Bot, Crown, LogIn, RotateCcw } from "lucide-react";
import {
  canManageGuild,
  destroySession,
  discordGuilds,
  forgetGuilds,
  getSession,
  GuildFetchError,
  type GuildFetchReason,
} from "../../lib/auth";
import { DashboardShell } from "../../components/dashboard-shell";
import { BrandedEmptyState } from "../../components/branded-empty-state";
import { BrandMark } from "../../components/brand-mark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/*
  Copy per failure cause. The point is that each one tells the visitor whether
  the fix is theirs (sign in again), a wait (rate limited), or nothing at all
  (Discord is slow or down).
*/
const failureCopy: Record<GuildFetchReason, { eyebrow: string; title: string; body: string }> = {
  expired: {
    eyebrow: "Session ended",
    title: "Discord signed you out",
    body: "Discord no longer accepts this session, usually because the authorisation was revoked or it simply aged out. Signing in again fixes it.",
  },
  "rate-limited": {
    eyebrow: "Rate limited",
    title: "Discord asked us to slow down",
    body: "Too many requests went to Discord for this account. Nothing is wrong with your configuration, and it clears on its own.",
  },
  timeout: {
    eyebrow: "Discord timed out",
    title: "Discord did not answer in time",
    body: "The request to Discord ran past its limit. Your servers and settings are untouched.",
  },
  upstream: {
    eyebrow: "Discord unavailable",
    title: "Discord could not be reached",
    body: "Discord returned an unexpected response. This is on their side, not yours, and your configuration is untouched.",
  },
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
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

  // ?refresh=1 busts the five-minute guild cache, so adding the bot or gaining
  // Manage Server does not mean waiting silently for the cache to age out.
  if ((await searchParams).refresh) forgetGuilds(session.accessToken);

  let all;
  try {
    all = await discordGuilds(session.accessToken);
  } catch (error) {
    const failure = error instanceof GuildFetchError ? error : new GuildFetchError("upstream");
    // The old code caught with a bare `} catch {`, discarding the error, so no
    // guild failure ever reached the logs. Never log the access token.
    console.error("dashboard_guild_fetch_failed", {
      userId: session.userId,
      reason: failure.reason,
      status: failure.status,
      retryAfterMs: failure.retryAfterMs,
    });
    // A 401 means Discord will not accept this session again, so holding on to
    // it only loops the visitor back here.
    if (failure.reason === "expired") await destroySession();
    const copy = failureCopy[failure.reason];
    const waitSeconds = failure.retryAfterMs ? Math.ceil(failure.retryAfterMs / 1_000) : null;
    return (
      <main className="grid min-h-dvh place-items-center px-5 py-16 text-center">
        <div>
          <BrandMark state={failure.reason === "expired" ? "paused" : "error"} className="mx-auto size-16" />
          <span className="mt-8 block font-mono text-[0.7rem] tracking-[0.2em] text-destructive-text uppercase">
            {copy.eyebrow}
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{copy.title}</h1>
          <p className="mx-auto mt-4 max-w-[54ch] leading-relaxed text-muted-foreground">{copy.body}</p>
          {waitSeconds && (
            <p className="mt-3 font-mono text-xs text-muted-foreground tnum">
              Discord asked for about {waitSeconds}s.
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {failure.reason === "expired" ? (
              <Button asChild variant="primary">
                <Link href="/api/auth/login">
                  Sign in with Discord
                  <LogIn />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="primary">
                  <Link href="/dashboard?refresh=1">
                    Try again
                    <RotateCcw />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/api/auth/login">Sign in again</Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-8 font-mono text-[0.65rem] text-muted-foreground">
            Signed in as {session.username}
          </p>
        </div>
      </main>
    );
  }

  const guilds = all
    .filter(canManageGuild)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name));

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
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground tnum">
            {guilds.length} of {all.length} available
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard?refresh=1">
              Refresh
              <RotateCcw />
            </Link>
          </Button>
        </div>
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

      {/*
        A zero result used to be indistinguishable from a failure. Saying how
        many guilds Discord returned makes the difference obvious: 0 of 0 means
        Discord sent nothing, 0 of 14 means the permission filter removed them.
      */}
      {!guilds.length && (
        <div className="mt-10">
          <BrandedEmptyState
            title={all.length ? "No servers you can manage" : "Discord returned no servers"}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild variant="primary">
                  <Link href="/api/auth/invite">
                    Add Inochi to a server
                    <Bot />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard?refresh=1">
                    Refresh
                    <RotateCcw />
                  </Link>
                </Button>
              </div>
            }
          >
            {all.length
              ? `Discord returned ${all.length} server${all.length === 1 ? "" : "s"} for this account, but none where you have Manage Server or Administrator. Ask an admin to grant it, then refresh.`
              : "Discord returned no servers at all for this account. If you expected some, the authorisation may be missing the guilds scope, which signing in again will fix."}
          </BrandedEmptyState>
        </div>
      )}
    </DashboardShell>
  );
}
