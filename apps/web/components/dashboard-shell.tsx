"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { Brand } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DashboardNavItem {
  href: string;
  label: string;
}

export function DashboardShell({
  children,
  guildName,
  nav = [],
}: {
  children: React.ReactNode;
  guildName?: string;
  nav?: DashboardNavItem[];
}) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const links = nav.length
    ? nav
    : [
        { href: "/dashboard", label: "Servers" },
        { href: "/", label: "Home" },
      ];
  const sectionHrefs = links.filter((item) => item.href.startsWith("#")).map((item) => item.href);
  const [active, setActive] = useState(sectionHrefs[0] ?? pathname);
  const sectionKey = sectionHrefs.join(",");

  // Focus trap and Escape handling, unchanged. This is the only thing keeping
  // the mobile drawer keyboard-usable.
  useEffect(() => {
    if (!open) return;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = [...(drawerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? [])];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = bodyOverflow; menuButtonRef.current?.focus(); };
  }, [open]);

  // Scroll-spy for the in-page settings anchors, unchanged.
  useEffect(() => {
    if (!sectionKey) return setActive(pathname);
    const sections = sectionHrefs.flatMap((href) => {
      const element = document.getElementById(href.slice(1));
      return element ? [{ href, element }] : [];
    });
    const update = () => {
      const anchor = Math.max(100, window.innerHeight * 0.28);
      let current = sections[0]?.href;
      for (const section of sections) if (section.element.getBoundingClientRect().top <= anchor) current = section.href;
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = sections.at(-1)?.href;
      if (current) setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname, sectionKey]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Mobile bar. Hidden once the sidebar becomes permanent at md. */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm md:hidden">
        <Link href="/dashboard" className="shrink-0">
          <Brand compact />
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {guildName ?? "Dashboard"}
        </span>
        <ThemeToggle />
        <Button
          ref={menuButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="dashboard-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu />
        </Button>
      </header>

      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        ref={drawerRef}
        id="dashboard-navigation"
        aria-label="Dashboard navigation"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(20rem,85vw)] flex-col border-l border-border bg-card p-5 transition-transform duration-200 ease-ink",
          "md:sticky md:top-0 md:right-auto md:z-20 md:h-dvh md:w-auto md:translate-x-0 md:border-l-0 md:border-r md:border-border",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <Link href="/dashboard">
            <Brand />
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
        </div>

        {guildName && (
          <div className="mt-8 border-y border-border py-4">
            <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
              Current server
            </span>
            <strong className="mt-1.5 block truncate text-sm font-semibold">{guildName}</strong>
          </div>
        )}

        <nav className="mt-6 -mr-2 grid gap-0.5 overflow-y-auto pr-2">
          {links.map((item) => {
            const isActive = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  isActive ? (item.href.startsWith("#") ? "location" : "page") : undefined
                }
                onClick={() => {
                  setActive(item.href);
                  setOpen(false);
                }}
                className={cn(
                  // Active is a vermilion left rule, not a tinted gradient pill.
                  "border-l-2 py-2 pl-3 text-sm transition-colors duration-160",
                  isActive
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form action="/api/auth/logout" method="post" className="mt-auto pt-6">
          <Button type="submit" variant="outline" size="sm" className="w-full">
            <LogOut />
            Sign out
          </Button>
        </form>
      </aside>

      <main className="min-w-0 px-5 pt-8 pb-24 md:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1120px]">{children}</div>
      </main>
    </div>
  );
}
