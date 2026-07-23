import type { Metadata } from "next";

export const metadata: Metadata = { title: "Developer API", description: "Read-only Inochi API and TypeScript SDK documentation." };

const endpoints = [
  ["GET", "/guilds/{guildId}", "Guild metadata"],
  ["GET", "/guilds/{guildId}/members/{userId}", "Member progression"],
  ["POST", "/guilds/{guildId}/members/bulk", "Up to 100 members"],
  ["GET", "/guilds/{guildId}/leaderboards/total", "Total XP leaderboard"],
  ["GET", "/guilds/{guildId}/leaderboards/weekly", "Weekly XP leaderboard"],
  ["GET", "/guilds/{guildId}/members/{userId}/rank", "Total or weekly rank"],
  ["GET", "/guilds/{guildId}/rewards", "Configured level rewards"],
] as const;

const codeStyle = { fontFamily: '"SFMono-Regular", Consolas, monospace', color: "#b5c6ff" } as const;

export default function DevelopersPage() {
  return <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at 80% 0, #18213d, transparent 30rem), #0c0d0f", padding: "clamp(2rem, 6vw, 6rem) 1.25rem 7rem" }}>
    <article style={{ width: "min(960px, 100%)", margin: "0 auto" }}>
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5rem", color: "#969ba5", fontSize: ".8rem" }}><a href="/" style={{ color: "#f4f2ec", fontWeight: 700 }}>INOCHI / API</a><a href="/api/v1/openapi.json">OpenAPI JSON</a></nav>
      <header style={{ borderBottom: "1px solid #2a2e35", paddingBottom: "3.5rem" }}>
        <p className="mono" style={{ color: "#8ba8ff", fontSize: ".7rem" }}>READ-ONLY CONTRACT / V1</p>
        <h1 style={{ maxWidth: 760, fontSize: "clamp(3.5rem, 9vw, 7.5rem)" }}>Progression data, without guesswork.</h1>
        <p className="lede">A typed, authenticated interface for guild metadata, members, ranks, leaderboards, and rewards. Every endpoint is scoped to an API key&apos;s managed guilds.</p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1px", margin: "3rem 0", background: "#2a2e35", border: "1px solid #2a2e35" }}>
        <div style={{ padding: "1.5rem", background: "#131519" }}><span className="mono" style={{ color: "#969ba5", fontSize: ".65rem" }}>BASE URL</span><p style={codeStyle}>/api/v1</p></div>
        <div style={{ padding: "1.5rem", background: "#131519" }}><span className="mono" style={{ color: "#969ba5", fontSize: ".65rem" }}>AUTHENTICATION</span><p style={codeStyle}>Bearer YOUR_API_KEY</p></div>
        <div style={{ padding: "1.5rem", background: "#131519" }}><span className="mono" style={{ color: "#969ba5", fontSize: ".65rem" }}>PAGE LIMIT</span><p style={codeStyle}>1-100 results</p></div>
      </section>

      <section style={{ padding: "3rem 0" }}>
        <p className="mono" style={{ color: "#969ba5", fontSize: ".65rem" }}>ENDPOINTS</p>
        <div style={{ borderTop: "1px solid #2a2e35" }}>{endpoints.map(([method, path, label]) => <div key={path + label} style={{ display: "grid", gridTemplateColumns: "4rem minmax(0, 1fr) minmax(130px, .5fr)", gap: "1rem", padding: "1.15rem 0", borderBottom: "1px solid #2a2e35", alignItems: "center" }}><strong style={{ ...codeStyle, fontSize: ".72rem" }}>{method}</strong><code style={{ overflowWrap: "anywhere" }}>{path}</code><span style={{ color: "#969ba5", fontSize: ".82rem" }}>{label}</span></div>)}</div>
      </section>

      <section style={{ padding: "3rem 0" }}>
        <p className="mono" style={{ color: "#969ba5", fontSize: ".65rem" }}>TYPESCRIPT SDK</p>
        <pre style={{ overflowX: "auto", padding: "1.5rem", border: "1px solid #2a2e35", borderRadius: ".7rem", background: "#101216", color: "#d7dae0", lineHeight: 1.7 }}><code>{`import { InochiClient } from "@inochi/sdk";

const inochi = new InochiClient({
  apiKey: process.env.INOCHI_API_KEY!,
  baseUrl: "https://your-instance.example/api/v1",
});

for await (const member of inochi.leaderboards.iterateTotal(guildId)) {
  console.log(member.rank, member.userId, member.xp);
}`}</code></pre>
        <p style={{ color: "#969ba5", lineHeight: 1.7 }}>Pass a custom <code>fetch</code> for testing or non-browser runtimes. Requests time out after 10 seconds by default. A <code>429</code> throws <code>InochiRateLimitError</code> with <code>retryAfterMs</code>; all other API failures throw <code>InochiApiError</code>.</p>
      </section>

      <section style={{ padding: "3rem 0", borderTop: "1px solid #2a2e35" }}>
        <h2 style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>Stable errors. Opaque cursors.</h2>
        <p className="lede">Errors use <code>{`{ error: { code, message, requestId, details? } }`}</code>. Follow <code>nextCursor</code> rather than constructing cursors; pagination is capped at 10,000 ranked results per traversal.</p>
        <a className="button primary" href="/api/v1/openapi.json">Inspect the OpenAPI contract</a>
      </section>
    </article>
  </main>;
}
