import Link from "next/link";
import { ArrowRight, Blocks, Database, Gamepad2, Github, LineChart, LockKeyhole, MoveUpRight, ShieldCheck, Sparkles } from "lucide-react";
import { getSession } from "../lib/auth";
import { LandingCurve } from "../components/landing-curve";

const features = [
  { icon: LineChart, title: "Curves you can reason about", text: "Preview exact thresholds, per-level costs, and long-term progression before saving." },
  { icon: ShieldCheck, title: "Atomic by default", text: "PostgreSQL transactions protect XP, game placements, imports, and restores under concurrency." },
  { icon: Sparkles, title: "A rank card worth sharing", text: "Crisp member cards, configurable accents, custom backgrounds, and clear next-level progress." },
  { icon: Gamepad2, title: "Progression with texture", text: "Word races, math rounds, vote boosts, weekly winners, role rewards, and channel policy." },
  { icon: LockKeyhole, title: "Privacy is a setting", text: "Private leaderboards, hidden profiles, encrypted OAuth tokens, and scoped read-only API keys." },
  { icon: Database, title: "Your data stays portable", text: "Versioned backups plus imports from Lurkr, MEE6, ProBot, Arcane, AmariBot, and CSV." },
];

export default async function Home() {
  const session = await getSession();
  const dashboardHref = session ? "/dashboard" : "/api/auth/login";
  return <div className="site-frame">
    <header className="site-header shell"><Link href="/" className="brand mono"><span className="brand-mark">生</span>Inochi</Link><nav><a href="#features">System</a><a href="#curve">Curve</a><a href="#architecture">Architecture</a></nav><Link className="button compact" href={dashboardHref}>{session ? "Dashboard" : "Sign in"}<ArrowRight size={15} /></Link></header>
    <main>
      <section className="hero shell">
        <div className="hero-copy"><div className="eyebrow mono">Self-hosted Discord progression</div><h1>Leveling with a pulse.</h1><p className="lede">A precise, expressive leveling system for communities that want control over the curve, the data, and the experience.</p><div className="hero-actions"><Link className="button primary" href={dashboardHref}>{session ? "Open your servers" : "Continue with Discord"}<MoveUpRight size={16} /></Link><a className="button ghost" href="https://github.com/vossgraves/Inochi" target="_blank" rel="noreferrer"><Github size={16} />View source</a></div><div className="trust-row mono"><span>PostgreSQL</span><span>Discord.js</span><span>TypeScript</span><span>Open source</span></div></div>
        <div className="product-stage" aria-label="Example Inochi rank card">
          <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
          <div className="mock-rank-card"><div className="mock-avatar">VG</div><div className="mock-rank-main"><div className="mock-rank-top"><span>Voss Graves</span><strong><small>LEVEL</small> 28</strong></div><div className="mock-metrics"><span>RANK <b>#12</b></span><span><b>38,351</b> TOTAL XP</span></div><div className="mock-progress"><i /></div><div className="mock-rank-foot"><span>3,051 / 4,000 THIS LEVEL</span><span>949 XP TO LEVEL 29</span></div></div></div>
          <div className="signal-card mono"><span>EVENT / MESSAGE</span><strong>+86 XP</strong><small>committed atomically</small></div>
        </div>
      </section>
      <section className="marquee"><div>CURVES · RANK CARDS · ROLE REWARDS · CHAT GAMES · IMPORTS · BACKUPS · LEADERBOARDS · API ·</div></section>
      <section className="section-block shell" id="features"><div className="section-intro"><span className="eyebrow mono">One progression system</span><h2>Every surface agrees.</h2><p>The bot, dashboard, public API, imports, and image renderer all share the same validated TypeScript domain.</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" key={title}><div className="feature-number mono">0{index + 1}</div><Icon size={21} /><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="curve-section" id="curve"><div className="shell"><LandingCurve /></div></section>
      <section className="section-block shell architecture" id="architecture"><div><span className="eyebrow mono">Designed to leave cleanly</span><h2>Own the stack. Keep the exit.</h2><p>Inochi runs as a web service and Discord worker over one PostgreSQL database. Deploy it on Railway, move it elsewhere later, and take complete backups whenever you want.</p><Link className="text-link" href={dashboardHref}>Configure your first server <ArrowRight size={15} /></Link></div><div className="architecture-map mono"><div><Blocks size={18}/>NEXT.JS DASHBOARD</div><span>↓</span><div><Database size={18}/>POSTGRESQL</div><span>↑</span><div><Gamepad2 size={18}/>DISCORD WORKER</div></div></section>
      <section className="final-cta"><div className="shell"><span className="eyebrow mono">Ready when your server is</span><h2>Make progression feel intentional.</h2><Link className="button primary" href={dashboardHref}>{session ? "Open dashboard" : "Continue with Discord"}<ArrowRight size={16}/></Link></div></section>
    </main>
    <footer className="site-footer shell"><div className="brand mono"><span className="brand-mark">生</span>Inochi</div><p>Self-hosted Discord progression. Original Polaris project by Colon.</p><a href="https://github.com/vossgraves/Inochi" target="_blank" rel="noreferrer">Source</a></footer>
  </div>;
}
