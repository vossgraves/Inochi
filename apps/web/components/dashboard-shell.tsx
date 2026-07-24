"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { Brand } from "./brand-mark";

export interface DashboardNavItem { href: string; label: string }

export function DashboardShell({ children, guildName, nav = [] }: { children: React.ReactNode; guildName?: string; nav?: DashboardNavItem[] }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const links = nav.length ? nav : [{ href: "/dashboard", label: "Servers" }, { href: "/", label: "Home" }];
  const sectionHrefs = links.filter((item) => item.href.startsWith("#")).map((item) => item.href);
  const [active, setActive] = useState(sectionHrefs[0] ?? pathname);
  const sectionKey = sectionHrefs.join(",");

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
  return <div className="dashboard-layout">
    <header className="mobile-appbar"><Link href="/dashboard" className="brand mono"><Brand /></Link><span>{guildName ?? "Dashboard"}</span><button ref={menuButtonRef} type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="dashboard-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button></header>
    {open && <button type="button" className="drawer-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside ref={drawerRef} id="dashboard-navigation" aria-label="Dashboard navigation" className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-head"><Link href="/dashboard" className="brand mono"><Brand /></Link><button type="button" className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button></div>
      {guildName && <div className="sidebar-context"><span className="mono">Current server</span><strong>{guildName}</strong></div>}
      <nav>{links.map((item) => <Link className={`nav-link ${active === item.href ? "active" : ""}`} href={item.href} key={item.href} aria-current={active === item.href ? (item.href.startsWith("#") ? "location" : "page") : undefined} onClick={() => { setActive(item.href); setOpen(false); }}>{item.label}</Link>)}</nav>
      <form action="/api/auth/logout" method="post" className="sidebar-signout"><button type="submit"><LogOut size={15} /> Sign out</button></form>
    </aside>
    <main className="dashboard-main">{children}</main>
  </div>;
}
