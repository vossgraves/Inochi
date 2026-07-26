import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "../../components/theme-toggle";

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

const facts = [
  ["Base URL", "/api/v1"],
  ["Authentication", "Bearer YOUR_API_KEY"],
  ["Page limit", "1-100 results"],
] as const;

export default function DevelopersPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-[62rem] items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-mono text-xs tracking-wider uppercase transition-colors hover:text-primary-text"
          >
            <ArrowLeft className="size-4" />
            Inochi / API
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/openapi.json">OpenAPI JSON</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[62rem] px-5 pt-16 pb-28">
        <header className="border-b border-border pb-14">
          <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Read-only contract / v1
          </p>
          <h1 className="mt-6 max-w-[20ch] text-4xl leading-tight font-bold tracking-tight sm:text-6xl">
            Progression data, without guesswork.
          </h1>
          <p className="mt-6 max-w-[62ch] leading-relaxed text-muted-foreground">
            A typed, authenticated interface for guild metadata, members, ranks, leaderboards, and
            rewards. Every endpoint is scoped to an API key&apos;s managed guilds.
          </p>
        </header>

        <dl className="grid border-b border-border sm:grid-cols-3">
          {facts.map(([label, value], index) => (
            <div
              key={label}
              className={`border-border px-5 py-5 ${index < facts.length - 1 ? "border-b sm:border-r sm:border-b-0" : ""}`}
            >
              <dt className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                {label}
              </dt>
              <dd className="mt-2 font-mono text-sm text-primary-text">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="py-14">
          <h2 className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Endpoints
          </h2>
          {/*
            One hairline under each row rather than a border on both edges, and
            the method column is mono so GET and POST line up.
          */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(([method, path, label]) => (
                  <tr key={path + label} className="border-t border-border">
                    <td className="w-16 py-4 align-top font-mono text-xs text-primary-text">{method}</td>
                    <td className="py-4 pr-6 align-top font-mono text-sm break-words">{path}</td>
                    <td className="w-52 py-4 align-top text-sm text-muted-foreground">{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            TypeScript SDK
          </h2>
          <pre className="mt-6 overflow-x-auto border border-border bg-card p-5 font-mono text-xs leading-relaxed">
            <code>{`import { InochiClient } from "@inochi/sdk";

const inochi = new InochiClient({
  apiKey: process.env.INOCHI_API_KEY!,
  baseUrl: "https://your-instance.example/api/v1",
});

for await (const member of inochi.leaderboards.iterateTotal(guildId)) {
  console.log(member.rank, member.userId, member.xp);
}`}</code>
          </pre>
          <p className="mt-6 max-w-[68ch] leading-relaxed text-muted-foreground">
            Pass a custom <code className="font-mono text-primary-text">fetch</code> for testing or
            non-browser runtimes. Requests time out after 10 seconds by default. A{" "}
            <code className="font-mono text-primary-text">429</code> throws{" "}
            <code className="font-mono text-primary-text">InochiRateLimitError</code> with{" "}
            <code className="font-mono text-primary-text">retryAfterMs</code>; all other API failures
            throw <code className="font-mono text-primary-text">InochiApiError</code>.
          </p>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="max-w-[20ch] text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            Stable errors. Opaque cursors.
          </h2>
          <p className="mt-5 max-w-[68ch] leading-relaxed text-muted-foreground">
            Errors use{" "}
            <code className="font-mono text-primary-text">{`{ error: { code, message, requestId, details? } }`}</code>
            . Follow <code className="font-mono text-primary-text">nextCursor</code> rather than
            constructing cursors; pagination is capped at 10,000 ranked results per traversal.
          </p>
          <Button asChild variant="primary" className="mt-8">
            <a href="/api/v1/openapi.json">Inspect the OpenAPI contract</a>
          </Button>
        </section>
      </main>
    </div>
  );
}
