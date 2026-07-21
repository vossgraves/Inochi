import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "../lib/auth";

export default async function Home() {
  const session = await getSession();
  return <>
    <header className="topbar"><div className="shell brand mono"><span className="brand-dot" />Inochi <span style={{ color: "#666" }}>/ open leveling system</span></div></header>
    <main className="shell hero">
      <section>
        <div className="eyebrow mono">Discord progression, under your control</div>
        <h1>Leveling without the noise.</h1>
        <p className="lede">A self-hosted XP system with precise curves, role rewards, monochrome rank cards, word games, live leaderboards, and migrations from the bots your community already uses.</p>
        <Link className="button primary" href={session ? "/dashboard" : "/api/auth/login"}>{session ? "Open dashboard" : "Continue with Discord"}<ArrowUpRight size={16} /></Link>
      </section>
      <aside className="terminal" aria-label="Feature log">
        <div className="terminal-head mono"><span>inochi / event stream</span><span>connected</span></div>
        <div className="terminal-body">
          <div>00:00:01 <strong>postgres</strong> transaction ready</div>
          <div>00:00:02 <strong>gateway</strong> shard 0 connected</div>
          <div>00:00:04 <strong>xp</strong> +86 awarded atomically</div>
          <div>00:00:04 <strong>roles</strong> level 12 synchronized</div>
          <div>00:00:09 <strong>game</strong> word round scheduled</div>
          <div>00:00:14 <strong>import</strong> ProBot page 3 captured</div>
          <div>00:00:15 <strong>rank</strong> image rendered in 34ms</div>
        </div>
      </aside>
    </main>
  </>;
}
