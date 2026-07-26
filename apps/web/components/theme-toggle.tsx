"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/*
  The blocking script in layout.tsx has already resolved the theme by the time
  this mounts, so the button reads the live class rather than storing its own
  copy. Dark is the default, so .light being absent means dark.
*/
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem("inochi-theme", next);
    } catch {
      // Private mode or blocked storage: the class still flips for this session.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // Rendered on the server with no theme resolved yet, so the label stays
      // generic until mount to avoid announcing the wrong action.
      aria-label={theme ? `Switch to ${theme === "light" ? "dark" : "light"} theme` : "Switch theme"}
      className={`inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none ${className}`}
    >
      <Sun size={15} className="hidden light:block" aria-hidden="true" />
      <Moon size={15} className="block light:hidden" aria-hidden="true" />
    </button>
  );
}
