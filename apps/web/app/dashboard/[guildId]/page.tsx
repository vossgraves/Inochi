import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getOrCreateGuild } from "@inochi/database";
import { analyzeCurve } from "@inochi/core";
import { requireGuildManager } from "../../../lib/auth";
import { SettingsForm } from "../../../components/settings-form";
import { DashboardShell } from "../../../components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const nav = [
  { href: "#overview", label: "Overview" },
  { href: "#xp", label: "XP earning" },
  { href: "#curve", label: "Level curve" },
  { href: "#level-up", label: "Announcements" },
  { href: "#rank", label: "Rank card" },
  { href: "#leaderboard", label: "Leaderboard" },
  { href: "#commands", label: "Commands" },
  { href: "#games", label: "Games" },
  { href: "#giveaways", label: "Giveaways" },
  { href: "#roles", label: "Roles & community" },
  { href: "#logging", label: "Logs & automation" },
  { href: "#imports", label: "Data & backups" },
];

export default async function GuildDashboard({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildManager(guildId);
  if (!access) redirect("/dashboard");
  const row = await getOrCreateGuild((await import("@inochi/database")).db, guildId, access.guild.name);
  const curve = analyzeCurve(row.settings);
  const enabled = row.settings.enabled;

  const stats = [
    { label: "Curve", value: curve.strictlyIncreasing ? "Healthy" : "Review" },
    { label: "Rewards", value: String(row.settings.rewards.length) },
    { label: "Games", value: row.settings.games.rotation.enabled ? "Auto" : "Manual" },
    { label: "Visibility", value: row.settings.leaderboard.visibility },
  ];

  return (
    <DashboardShell guildName={access.guild.name} nav={nav}>
      <div className="reveal flex flex-wrap items-end justify-between gap-4 border-b border-border pb-8">
        <div className="min-w-0">
          <span className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase tnum">
            Server control / {guildId}
          </span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight break-words sm:text-5xl">
            {access.guild.name}
          </h1>
          <p className="mt-3 max-w-[58ch] leading-relaxed text-muted-foreground">
            One configuration shared by the dashboard, Discord worker, and public API.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/leaderboard/${guildId}`} target="_blank">
            Leaderboard
            <ExternalLink />
          </Link>
        </Button>
      </div>

      {/*
        System state reads as one honest row: whether XP is being earned, and
        the four numbers that describe the configuration. The old version was a
        conic-gradient panel with a per-stat hover tint.
      */}
      <section id="overview" className="reveal mt-10 scroll-mt-24 border border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <Badge variant={enabled ? "drawn" : "ended"}>{enabled ? "Earning XP" : "Paused"}</Badge>
            <span className="font-mono text-xs text-muted-foreground tnum">
              {enabled
                ? `${row.settings.gain.min}-${row.settings.gain.max} XP every ${row.settings.gain.cooldownSeconds}s`
                : "Enable XP below when you are ready."}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={`border-border px-5 py-4 ${index % 2 === 0 ? "border-r" : ""} ${index < 2 ? "border-b lg:border-b-0" : ""} lg:border-r lg:last:border-r-0`}
            >
              <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                {stat.label}
              </dt>
              <dd className="mt-1.5 text-lg font-semibold capitalize">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {!row.setupCompletedAt && (
        <p className="reveal mt-6 border border-warning/40 px-4 py-3 text-sm leading-relaxed text-warning">
          This server has not completed guided setup.{" "}
          <Link className="underline underline-offset-4" href={`/dashboard/${guildId}/setup`}>
            Open the setup wizard
          </Link>{" "}
          before enabling XP.
        </p>
      )}

      <SettingsForm guildId={guildId} initial={row.settings} initialRevision={row.settingsRevision} />
    </DashboardShell>
  );
}
