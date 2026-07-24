import type { CSSProperties } from "react";

interface BrandMarkProps {
  className?: string;
  label?: string;
  state?: "idle" | "active" | "paused" | "pending" | "success" | "warning" | "error";
}

export function BrandMark({ className = "", label, state = "idle" }: BrandMarkProps) {
  return <svg
    className={`life-mark life-mark-${state} ${className}`.trim()}
    viewBox="0 0 64 64"
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    style={{ "--life-mark-delay": `${state === "active" ? "-1.2s" : "0s"}` } as CSSProperties}
  >
    <defs>
      <linearGradient id="life-mark-spectrum" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop stopColor="#b8aaff" />
        <stop offset=".48" stopColor="#7c8dff" />
        <stop offset=".76" stopColor="#25d0f5" />
        <stop offset="1" stopColor="#ff77b2" />
      </linearGradient>
    </defs>
    <circle className="life-mark-halo" cx="32" cy="32" r="27" />
    <path className="life-mark-orbit" pathLength="1" d="M32 5a27 27 0 1 1-19.1 7.9" />
    <path className="life-mark-pulse" pathLength="1" d="M7 35h10l4-8 6 17 7-27 6 18h17" />
    <g className="life-mark-kanji" transform="translate(12 4) scale(.37)">
      <path d="M51.75 10.25c.11 1-.06 2.67-.71 4.02-4.47 9.23-17.06 25.98-38.79 38.48" />
      <path d="M53.5 15c7.12 7 22.89 20.46 30.6 26.65 2.82 2.26 5.65 4.22 9.15 5.72" />
      <path d="M38.25 40.64c1.76.72 3.84.36 5.65.14 5.4-.66 13.08-1.76 18.48-2.24 1.88-.17 3.54-.23 5.37.21" />
      <path d="M21.2 54.29c1.01 1.01 1.59 2.26 1.67 3.43.9 3.88 1.77 10.12 2.4 15.89.16 1.43.3 2.79.42 4.04" />
      <path d="M23.92 56.51c10.83-1.76 15.42-2.18 20.28-2.65 1.78-.17 2.79 1.16 2.49 2.28-1.23 4.63-1.67 9.73-3.48 16.13" />
      <path d="M26.02 75.17c4.77-.44 9.31-1.17 15.25-1.89 1.17-.14 2.39-.28 3.68-.42" />
      <path d="M54 54c.61.15 3 1 4.21.87 3.29-.37 17.99-4.02 19.51-4.17 1.52-.15 4.28-.29 3.95 2.89-.43 4.17-2.68 16.92-6 23.84-1.89 3.94-3.18 3.45-6.23.46" />
      <path d="M57.38 55.38c.87.87 1.8 2 1.8 3.5 0 7.36-.04 24.53-.1 34.13-.02 3.3-.05 5.71-.08 6.51" />
    </g>
    <circle className="life-mark-spark life-mark-spark-a" cx="51.5" cy="12.5" r="2" />
    <circle className="life-mark-spark life-mark-spark-b" cx="56" cy="20" r="1" />
  </svg>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand-lockup"><span className="brand-mark"><BrandMark /></span>{!compact && <span>Inochi</span>}</span>;
}
