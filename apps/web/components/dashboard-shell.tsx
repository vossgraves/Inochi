"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";

export interface DashboardNavItem { href: string; label: string }

export function DashboardShell({ children, guildName, nav = [] }: { children: React.ReactNode; guildName?: string; nav?: DashboardNavItem[] }) {
  const [open, setOpen] = useState(false);
  const links = nav.length ? nav : [{ href: "/dashboard", label: "Servers" }, { href: "/", label: "Home" }];
  return <div className="dashboard-layout">
    <header className="mobile-appbar"><Link href="/dashboard" className="brand mono"><span className="brand-mark">生</span>Inochi</Link><span>{guildName ?? "Dashboard"}</span><button type="button" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button></header>
    {open && <button type="button" className="drawer-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-head"><Link href="/dashboard" className="brand mono"><span className="brand-mark">生</span>Inochi</Link><button type="button" className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button></div>
      {guildName && <div className="sidebar-context"><span className="mono">Current server</span><strong>{guildName}</strong></div>}
      <nav>{links.map((item, index) => <a className={`nav-link ${index === 0 ? "active" : ""}`} href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}</nav>
      <form action="/api/auth/logout" method="post" className="sidebar-signout"><button type="submit"><LogOut size={15} /> Sign out</button></form>
    </aside>
    <main className="dashboard-main">{children}</main>
  </div>;
}
