import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Bot,
  Database,
  Gamepad2,
  Github,
  Gift,
  LineChart,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getSession } from "../lib/auth";
import { LandingCurve } from "../components/landing-curve";
import { Brand, Kanji } from "../components/brand-mark";
import { ThemeToggle } from "../components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/*
  Seven sections, six distinct layout families, two eyebrows total.

  What this replaced: an aurora-blob hero over a div-mock rank card, a bento
  grid of cursor-spotlight cards, a scrolling capability marquee, orbit rings
  and a dashed-beam architecture diagram.
*/

const features = [
  {
    icon: LineChart,
    title: "Curves you can reason about",
    text: "Preview exact thresholds, per-level costs, and long-term progression before saving.",
  },
  {
    icon: Sparkles,
    title: "A rank card worth sharing",
    text: "Crisp member cards, configurable accents, custom backgrounds, and clear next-level progress.",
  },
  {
    icon: ShieldCheck,
    title: "Atomic by default",
    text: "PostgreSQL transactions protect XP, imports, games, and restores under concurrency.",
  },
  {
    icon: Gamepad2,
    title: "Games that award real XP",
    text: "Word races, math rounds, vote boosts, weekly winners, role rewards, and channel policy.",
  },
  {
    icon: LockKeyhole,
    title: "Privacy is a setting",
    text: "Private leaderboards, hidden profiles, encrypted OAuth tokens, and scoped API keys.",
  },
  {
    icon: Database,
    title: "Your data stays portable",
    text: "Versioned backups plus reviewed imports from every major Discord leveling provider.",
  },
] as const;

// Illustrative rows for the /top preview below. Deliberately uneven numbers and
// handles that read like real Discord members rather than placeholder names.
const sampleRanks = [
  { handle: "kazegami", level: 41, xp: 92104 },
  { handle: "mirelle.wav", level: 38, xp: 84220 },
  { handle: "tsukibrew", level: 33, xp: 61478 },
  { handle: "orenji_", level: 31, xp: 54903 },
  { handle: "hollowpine", level: 28, xp: 38351 },
] as const;

const pipeline = [
  {
    title: "Activity enters",
    text: "Messages and commands pass channel, cooldown, and privacy rules.",
  },
  {
    title: "Progress commits",
    text: "XP, levels, games, and rewards update in one transaction.",
  },
  {
    title: "Every surface updates",
    text: "Cards, roles, leaderboards, dashboard, and API stay aligned.",
  },
] as const;

export default async function Home() {
  const session = await getSession();
  const dashboardHref = session ? "/dashboard" : "/api/auth/login";
  const dashboardLabel = session ? "Open dashboard" : "Sign in";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-6 px-5">
          <Link href="/" className="shrink-0">
            <Brand />
          </Link>
          <nav className="hidden items-center gap-7 font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase md:flex">
            <a className="transition-colors hover:text-foreground" href="#curve">
              Curve
            </a>
            <a className="transition-colors hover:text-foreground" href="#features">
              Features
            </a>
            <a className="transition-colors hover:text-foreground" href="#giveaways">
              Giveaways
            </a>
            <Link className="transition-colors hover:text-foreground" href="/commands">
              Commands
            </Link>
            <Link className="transition-colors hover:text-foreground" href="/developers">
              API
            </Link>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href={dashboardHref}>{dashboardLabel}</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/api/auth/invite">
                Add to server
                <Bot />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* 1. Hero: asymmetric split, 5/7. Four text elements, no more. */}
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-[1240px] items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-12 lg:gap-16 lg:pt-24 lg:pb-28">
            <div className="reveal lg:col-span-5">
              <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
                Self-hosted Discord progression
              </p>
              <h1 className="mt-6 flex items-start gap-5 text-5xl leading-[0.95] font-bold tracking-tight sm:text-6xl lg:text-[4.25rem]">
                <Kanji className="mt-1 text-6xl text-primary-text sm:text-7xl lg:text-[5rem]" />
                <span>Levels your server owns.</span>
              </h1>
              <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-muted-foreground">
                Set the curve exactly, keep the data in your own PostgreSQL, and take it with you.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link href="/api/auth/invite">
                    Add to server
                    <Bot />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={dashboardHref}>
                    {dashboardLabel}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="reveal lg:col-span-7">
              {/*
                The real renderer's output, produced by scripts/render-sample-card.ts
                using the same code path as /rank. Not a div mock.
              */}
              <figure className="m-0">
                <Image
                  src="/brand/sample-rank-card.png"
                  alt="An Inochi rank card showing a member at level 28, rank 12, with 38,351 total XP and 949 XP to the next level."
                  width={960}
                  height={300}
                  priority
                  className="h-auto w-full rounded-md border border-border"
                />
                <figcaption className="mt-3 font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  Rendered by /rank
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* 2. Curve: the actual differentiator, and interactive. */}
        <section id="curve" className="border-b border-border scroll-mt-16">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 lg:py-28">
            <div className="reveal">
              <LandingCurve />
            </div>
          </div>
        </section>

        {/* 3. Features: editorial hairline rows with a mono index. No bento. */}
        <section id="features" className="border-b border-border scroll-mt-16">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 lg:py-28">
            <h2 className="reveal max-w-[18ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
              One system, agreed on by every surface.
            </h2>
            <p className="reveal mt-5 max-w-[62ch] leading-relaxed text-muted-foreground">
              The bot, dashboard, API, importers, and image renderer all read the same validated
              settings and the same level curve.
            </p>
            <div className="mt-14">
              {features.map(({ icon: Icon, title, text }, index) => (
                <article
                  key={title}
                  className="reveal grid grid-cols-[auto_1fr] items-start gap-x-5 gap-y-2 border-t border-border py-7 sm:grid-cols-[3.5rem_1.75rem_1fr] sm:gap-x-6 md:grid-cols-[3.5rem_1.75rem_minmax(0,22rem)_1fr]"
                >
                  <span className="font-mono text-xs tracking-wider text-muted-foreground tnum">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Icon className="size-5 text-primary-text sm:mt-0.5" aria-hidden="true" />
                  <h3 className="col-start-2 text-lg font-semibold tracking-tight sm:col-start-3">
                    {title}
                  </h3>
                  <p className="col-start-2 max-w-[62ch] leading-relaxed text-muted-foreground sm:col-start-3 md:col-start-4 md:pt-0.5">
                    {text}
                  </p>
                </article>
              ))}
              <div className="border-t border-border" />
            </div>
          </div>
        </section>

        {/* 4. Leaderboard: a dense mono table, the same shape /top produces. */}
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 lg:py-28">
            <div className="reveal flex flex-wrap items-end justify-between gap-4">
              <h2 className="max-w-[20ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
                Standings that stay honest.
              </h2>
              <Badge variant="outline">Example server</Badge>
            </div>
            <div className="reveal mt-12 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                    <th scope="col" className="w-16 py-3 font-normal">
                      Rank
                    </th>
                    <th scope="col" className="py-3 font-normal">
                      Member
                    </th>
                    <th scope="col" className="w-24 py-3 text-right font-normal">
                      Level
                    </th>
                    <th scope="col" className="w-36 py-3 text-right font-normal">
                      Total XP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRanks.map((row, index) => (
                    <tr key={row.handle} className="border-b border-border/60">
                      <td className="py-4 font-mono text-sm text-primary-text tnum">
                        {String(index + 1).padStart(2, "0")}
                      </td>
                      <td className="py-4 font-medium">{row.handle}</td>
                      <td className="py-4 text-right font-mono text-sm tnum">{row.level}</td>
                      <td className="py-4 text-right font-mono text-sm text-muted-foreground tnum">
                        {row.xp.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="reveal mt-6 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
              Publish it on the web, pin it to a channel that updates itself, or keep it to managers
              only. Weekly standings track separately from all-time.
            </p>
          </div>
        </section>

        {/* 5. Architecture: a vertical hairline flow, no gradient beams. */}
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-5 py-20 lg:grid-cols-12 lg:gap-20 lg:py-28">
            <div className="reveal lg:col-span-5">
              <h2 className="max-w-[16ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
                Own the stack. Keep the exit.
              </h2>
              <p className="mt-5 max-w-[52ch] leading-relaxed text-muted-foreground">
                One PostgreSQL truth connects Discord activity, the worker, dashboard, API, cards,
                and leaderboards. Deploy it where you want and take complete backups whenever you
                want.
              </p>
              <Link
                className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary-text underline-offset-4 hover:underline"
                href={dashboardHref}
              >
                Configure your first server
                <ArrowRight className="size-4" />
              </Link>
            </div>
            <ol className="reveal lg:col-span-7 lg:pt-2">
              {pipeline.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[3rem_1fr] items-start gap-x-5 border-t border-border py-8"
                >
                  <span className="font-mono text-xs tracking-wider text-muted-foreground tnum">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                      {step.text}
                    </p>
                  </div>
                </li>
              ))}
              <li className="border-t border-border" />
            </ol>
          </div>
        </section>

        {/*
          6. Giveaways: designed, not wired. The backend lands in the next
          change; this section and the dashboard nav slot are the anchors.
        */}
        <section id="giveaways" className="border-b border-border scroll-mt-16">
          <div className="mx-auto grid w-full max-w-[1240px] items-center gap-12 px-5 py-20 lg:grid-cols-12 lg:gap-16 lg:py-28">
            <div className="reveal lg:col-span-7">
              <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
                In development
              </p>
              <h2 className="mt-6 max-w-[18ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
                Giveaways, weighted by the levels people earned.
              </h2>
              <p className="mt-5 max-w-[58ch] leading-relaxed text-muted-foreground">
                Entries drawn from the same progression data the rest of Inochi runs on, so
                long-standing members can carry better odds than an account that joined this
                morning.
              </p>
            </div>
            <div className="reveal lg:col-span-5">
              <div className="border border-border">
                <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                  <Gift className="size-4 text-primary-text" aria-hidden="true" />
                  <span className="font-mono text-[0.7rem] tracking-wider uppercase">
                    Nitro, one month
                  </span>
                  <Badge variant="live" className="ml-auto">
                    Live
                  </Badge>
                </div>
                <dl className="grid grid-cols-2">
                  <div className="border-r border-b border-border px-5 py-4">
                    <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                      Entries
                    </dt>
                    <dd className="mt-1.5 font-mono text-xl tnum">184</dd>
                  </div>
                  <div className="border-b border-border px-5 py-4">
                    <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                      Minimum level
                    </dt>
                    <dd className="mt-1.5 font-mono text-xl tnum">10</dd>
                  </div>
                  <div className="border-r border-border px-5 py-4">
                    <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                      Draws
                    </dt>
                    <dd className="mt-1.5 font-mono text-xl tnum">3</dd>
                  </div>
                  <div className="px-5 py-4">
                    <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                      Closes
                    </dt>
                    <dd className="mt-1.5 font-mono text-xl tnum">48h</dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                Interface preview
              </p>
            </div>
          </div>
        </section>

        {/* 7. Close. */}
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-24 text-center lg:py-32">
            <Kanji className="reveal block text-6xl text-primary-text" />
            <h2 className="reveal mx-auto mt-8 max-w-[16ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
              Give progression to your community, not to a vendor.
            </h2>
            <div className="reveal mt-10 flex flex-wrap justify-center gap-3">
              <Button asChild variant="primary" size="lg">
                <Link href="/api/auth/invite">
                  Add to server
                  <Bot />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={dashboardHref}>
                  {dashboardLabel}
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-6 px-5 py-10">
        <Brand />
        <p className="text-sm text-muted-foreground">
          Independent, self-hosted Discord progression.
        </p>
        <a
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="https://github.com/vossgraves/Inochi"
          target="_blank"
          rel="noreferrer"
        >
          <Github className="size-4" />
          Source
        </a>
      </footer>
    </div>
  );
}
