import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { administratorCommands, memberCommands } from "../../../bot/src/commands/metadata";
import { ThemeToggle } from "../../components/theme-toggle";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Commands", description: "Complete Inochi slash and prefix command reference." };

/*
  The old layout gave every command a top AND bottom hairline, so a 78-entry
  reference read as one long ruled ledger. Commands are now grouped under two
  cluster headings, with a single rule between entries and the group heading
  carrying the count.
*/
function CommandGroup({
  id,
  title,
  description,
  commands,
}: {
  id: string;
  title: string;
  description: string;
  commands: typeof memberCommands;
}) {
  return (
    <section id={id} className="scroll-mt-20 pt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-primary pb-4">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground tnum">
          {commands.length} commands
        </span>
      </div>
      <p className="mt-4 max-w-[68ch] leading-relaxed text-muted-foreground">{description}</p>

      <div className="mt-10">
        {commands.map((command) => (
          <article
            key={command.name}
            id={command.name}
            className="grid scroll-mt-20 gap-4 border-b border-border py-7 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-10"
          >
            <div>
              <h3 className="font-mono text-base font-semibold text-primary-text">
                /{command.name}
              </h3>
              {command.aliases.length > 1 && (
                <p className="mt-2 font-mono text-[0.65rem] leading-relaxed tracking-wider text-muted-foreground">
                  {command.aliases.slice(1).join(" / ")}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{command.permission}</p>
            </div>
            <div className="min-w-0">
              <p className="leading-relaxed">{command.description}</p>
              <div className="mt-4 grid gap-1.5">
                {command.slashUsage.map((usage) => (
                  <code
                    key={usage}
                    className="w-fit max-w-full border border-border px-2.5 py-1.5 font-mono text-xs break-words"
                  >
                    {usage}
                  </code>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function CommandsPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-[62rem] items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-mono text-xs tracking-wider uppercase transition-colors hover:text-primary-text"
          >
            <ArrowLeft className="size-4" />
            Inochi / Commands
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm">
              <Link href="/developers">Developer API</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[62rem] px-5 pt-16 pb-28">
        <header>
          <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Complete reference
          </p>
          <h1 className="mt-6 max-w-[18ch] text-4xl leading-tight font-bold tracking-tight sm:text-6xl">
            Every command. No hidden manual.
          </h1>
          <p className="mt-6 max-w-[62ch] leading-relaxed text-muted-foreground">
            Use slash commands everywhere, or enable a custom server prefix. Detailed aliases,
            permissions, and usage are also available through{" "}
            <code className="font-mono text-primary-text">/help command:name</code>.
          </p>
          <nav className="mt-8 flex gap-6 font-mono text-[0.7rem] tracking-wider uppercase">
            <a className="text-muted-foreground transition-colors hover:text-foreground" href="#member">
              Member
            </a>
            <a className="text-muted-foreground transition-colors hover:text-foreground" href="#administrator">
              Administrator
            </a>
          </nav>
        </header>

        <CommandGroup
          id="member"
          title="Member commands"
          description="Available to everyone in the server, subject to the channel policy and privacy settings."
          commands={memberCommands}
        />
        <CommandGroup
          id="administrator"
          title="Administrator commands"
          description="Restricted to members with the listed Discord permission. These change configuration or progression data."
          commands={administratorCommands}
        />
      </main>
    </div>
  );
}
