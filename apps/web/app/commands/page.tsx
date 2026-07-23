import type { Metadata } from "next";
import { administratorCommands, memberCommands } from "../../../bot/src/commands/metadata";

export const metadata: Metadata = { title: "Commands", description: "Complete Inochi slash and prefix command reference." };

function CommandList({ commands }: { commands: typeof memberCommands }) {
  return <div style={{ borderTop: "1px solid var(--border)" }}>{commands.map((command) => <article id={command.name} key={command.name} style={{ display: "grid", gridTemplateColumns: "minmax(10rem, .45fr) minmax(0, 1fr)", gap: "clamp(1rem, 4vw, 4rem)", padding: "2rem 0", borderBottom: "1px solid var(--border)" }}>
    <div><h3 style={{ margin: 0, fontSize: "1.35rem" }}><code>/{command.name}</code></h3><p className="mono" style={{ color: "var(--muted)", fontSize: ".58rem", lineHeight: 1.8 }}>{command.aliases.length > 1 ? command.aliases.slice(1).join(" / ") : "NO ALIASES"}</p></div>
    <div><p style={{ marginTop: 0, color: "#c5c8cf", lineHeight: 1.7 }}>{command.description}</p><p style={{ color: "var(--muted)", fontSize: ".8rem" }}>{command.permission}</p><div style={{ display: "grid", gap: ".45rem", marginTop: "1rem" }}>{command.slashUsage.map((usage) => <code key={usage} style={{ width: "fit-content", maxWidth: "100%", padding: ".45rem .65rem", border: "1px solid var(--border)", borderRadius: ".4rem", color: "var(--accent-strong)", overflowWrap: "anywhere" }}>{usage}</code>)}</div></div>
  </article>)}</div>;
}

export default function CommandsPage() {
  return <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at 80% 0, #18213d, transparent 30rem), var(--background)", padding: "clamp(2rem, 6vw, 6rem) 1.25rem 7rem" }}>
    <article style={{ width: "min(960px, 100%)", margin: "0 auto" }}>
      <nav style={{ display: "flex", justifyContent: "space-between", marginBottom: "5rem", color: "var(--muted)", fontSize: ".8rem" }}><a href="/" style={{ color: "var(--foreground)", fontWeight: 700 }}>INOCHI / COMMANDS</a><a href="/developers">Developer API</a></nav>
      <header style={{ paddingBottom: "4rem" }}><p className="mono" style={{ color: "var(--accent)", fontSize: ".7rem" }}>COMPLETE REFERENCE</p><h1 style={{ fontSize: "clamp(3.5rem, 9vw, 7.5rem)" }}>Every command. No hidden manual.</h1><p className="lede">Use slash commands everywhere, or enable a custom server prefix. Detailed aliases, permissions, and usage are also available through <code>/help command:name</code>.</p></header>
      <section><p className="mono" style={{ color: "var(--muted)", fontSize: ".65rem" }}>MEMBER / {memberCommands.length}</p><CommandList commands={memberCommands} /></section>
      <section style={{ paddingTop: "6rem" }}><p className="mono" style={{ color: "var(--muted)", fontSize: ".65rem" }}>ADMINISTRATOR / {administratorCommands.length}</p><CommandList commands={administratorCommands} /></section>
    </article>
  </main>;
}
