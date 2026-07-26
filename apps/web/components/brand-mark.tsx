import { cn } from "@/lib/utils";

export type BrandState =
  | "idle"
  | "active"
  | "paused"
  | "pending"
  | "success"
  | "warning"
  | "error";

/*
  The mark is the 命 kanji inside a seal-style square, drawn in strokes.

  What changed from the old mark: the violet -> cyan -> pink `life-mark-spectrum`
  gradient, the breathing halo, the spinning orbit and the ECG pulse line are
  gone. What is left is the kanji and a single ring, in one colour, with state
  carried by colour alone rather than by animation.
*/
const stateColor: Record<BrandState, string> = {
  idle: "text-foreground",
  active: "text-primary-text",
  paused: "text-muted-foreground",
  pending: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

// The stroke skeleton of 命. Legible as a mark down to ~16px; for display sizes
// use <Kanji>, which sets the real glyph in the subsetted Noto Serif JP.
const KANJI_STROKES = [
  "M51.75 10.25c.11 1-.06 2.67-.71 4.02-4.47 9.23-17.06 25.98-38.79 38.48",
  "M53.5 15c7.12 7 22.89 20.46 30.6 26.65 2.82 2.26 5.65 4.22 9.15 5.72",
  "M38.25 40.64c1.76.72 3.84.36 5.65.14 5.4-.66 13.08-1.76 18.48-2.24 1.88-.17 3.54-.23 5.37.21",
  "M21.2 54.29c1.01 1.01 1.59 2.26 1.67 3.43.9 3.88 1.77 10.12 2.4 15.89.16 1.43.3 2.79.42 4.04",
  "M23.92 56.51c10.83-1.76 15.42-2.18 20.28-2.65 1.78-.17 2.79 1.16 2.49 2.28-1.23 4.63-1.67 9.73-3.48 16.13",
  "M26.02 75.17c4.77-.44 9.31-1.17 15.25-1.89 1.17-.14 2.39-.28 3.68-.42",
  "M54 54c.61.15 3 1 4.21.87 3.29-.37 17.99-4.02 19.51-4.17 1.52-.15 4.28-.29 3.95 2.89-.43 4.17-2.68 16.92-6 23.84-1.89 3.94-3.18 3.45-6.23.46",
  "M57.38 55.38c.87.87 1.8 2 1.8 3.5 0 7.36-.04 24.53-.1 34.13-.02 3.3-.05 5.71-.08 6.51",
];

export function BrandMark({
  className,
  label,
  state = "idle",
}: {
  className?: string;
  label?: string;
  state?: BrandState;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("block", stateColor[state], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect
        x="2.5"
        y="2.5"
        width="59"
        height="59"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeOpacity={state === "paused" ? 0.25 : 0.45}
        strokeWidth="2"
      />
      <g
        transform="translate(11 3) scale(.42)"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={state === "paused" ? 0.55 : 1}
      >
        {KANJI_STROKES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/*
  The real glyph, for display sizes. Backed by a 992-byte subset of Noto Serif
  JP containing only U+547D, so this costs almost nothing.

  It carries an aria-label because 命 is meaningful content here (it is the
  product name), not decoration.
*/
export function Kanji({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-kanji leading-none select-none", className)}
      role="img"
      aria-label="Inochi, Japanese for life"
    >
      命
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark className="size-6" />
      {!compact && (
        <span className="font-mono text-xs font-bold tracking-[0.18em] uppercase">Inochi</span>
      )}
    </span>
  );
}
