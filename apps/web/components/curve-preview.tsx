"use client";

import { useDeferredValue, useId, useState } from "react";
import { analyzeCurve, curveBenchmarks, xpBetweenLevels, xpForLevel } from "@inochi/core";
import type { GuildSettings } from "@inochi/core";
import { cn } from "@/lib/utils";

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/*
  Plot maths is unchanged. What changed is the paint: the cyan-to-violet fill
  gradient and the glow drop-shadow on the line are gone, the line is the one
  vermilion, and the level marker is positioned with an SVG circle rather than
  a CSS custom property driving an absolutely positioned element.
*/
export function CurvePreview({
  settings,
  compactView = false,
}: {
  settings: GuildSettings;
  compactView?: boolean;
}) {
  const id = useId();
  const deferred = useDeferredValue(settings);
  const [mode, setMode] = useState<"total" | "step">("total");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [selected, setSelected] = useState(Math.min(10, deferred.curve.maxLevel));
  const configuredMaxLevel = Math.max(1, deferred.curve.maxLevel);
  const maxLevel = Math.min(150, configuredMaxLevel);
  const level = Math.min(selected, maxLevel);
  const levels = Array.from({ length: maxLevel }, (_, index) => index + 1);
  const values = levels.map((point) =>
    mode === "total" ? xpForLevel(point, deferred) : xpBetweenLevels(Math.max(0, point - 1), deferred),
  );
  const transformed = values.map((value) => (scale === "log" ? Math.log10(Math.max(1, value)) : value));
  const maximum = Math.max(1, ...transformed);
  const points = levels
    .map((point, index) => {
      const x = ((point - 1) / Math.max(1, maxLevel - 1)) * 100;
      const y = 100 - (transformed[index]! / maximum) * 88;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const selectedValue =
    mode === "total" ? xpForLevel(level, deferred) : xpBetweenLevels(Math.max(0, level - 1), deferred);
  const selectedX = ((level - 1) / Math.max(1, maxLevel - 1)) * 100;
  const selectedYValue = scale === "log" ? Math.log10(Math.max(1, selectedValue)) : selectedValue;
  const selectedY = 100 - (selectedYValue / maximum) * 88;
  const diagnostics = analyzeCurve(deferred);
  const benchmarkLevels = [
    ...new Set([1, 5, 10, 25, 50, 75, 100, 125, 150, maxLevel].filter((value) => value <= maxLevel)),
  ];
  const benchmarks = curveBenchmarks(deferred, benchmarkLevels);

  const segmentButton = (active: boolean) =>
    cn(
      "px-3 py-1.5 font-mono text-[0.65rem] tracking-wider uppercase transition-colors duration-160",
      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="border border-border">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h3 className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
          Progression geometry
        </h3>
        <div
          className="inline-flex border border-border"
          role="group"
          aria-label="Curve display mode"
        >
          <button
            type="button"
            aria-pressed={mode === "total"}
            className={segmentButton(mode === "total")}
            onClick={() => setMode("total")}
          >
            Total XP
          </button>
          <button
            type="button"
            aria-pressed={mode === "step"}
            className={cn(segmentButton(mode === "step"), "border-l border-border")}
            onClick={() => setMode("step")}
          >
            Per level
          </button>
        </div>
      </div>

      <div className="px-5 pt-6">
        <div className={cn("relative w-full", compactView ? "h-56" : "h-64 sm:h-72")}>
          <svg
            viewBox="0 0 100 106"
            role="img"
            aria-label={`${mode === "total" ? "Total XP" : "XP per level"} curve through level ${maxLevel}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            {[20, 40, 60, 80].map((y) => (
              <line
                key={y}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.3"
                strokeDasharray="1.5 1.5"
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              points={points}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={selectedX}
              x2={selectedX}
              y1="8"
              y2="100"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              className="text-border-strong"
              vectorEffect="non-scaling-stroke"
            />
            {/*
              preserveAspectRatio="none" stretches the viewBox, so a circle would
              render as an ellipse. Two crossing lines stay true at any ratio.
            */}
            <line
              x1={selectedX}
              x2={selectedX}
              y1={selectedY - 3}
              y2={selectedY + 3}
              stroke="var(--primary)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={selectedX - 2}
              x2={selectedX + 2}
              y1={selectedY}
              y2={selectedY}
              stroke="var(--primary)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="mt-2 flex justify-between font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
          <span>LV 1</span>
          <span>LV {maxLevel}</span>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border px-5 py-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
        <label
          htmlFor={`${id}-level`}
          className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase"
        >
          Level <strong className="text-foreground tnum">{level}</strong>
        </label>
        <input
          id={`${id}-level`}
          type="range"
          min="1"
          max={maxLevel}
          step="1"
          value={level}
          onChange={(event) => setSelected(Number(event.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <div className="sm:text-right">
          <strong className="block font-mono text-lg text-primary-text tnum">
            {selectedValue.toLocaleString()} XP
          </strong>
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
            {mode === "total" ? "total threshold" : "from previous level"}
          </span>
        </div>
      </div>

      {!compactView && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              className="font-mono text-[0.7rem] tracking-wider text-primary-text uppercase underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => setScale((value) => (value === "linear" ? "log" : "linear"))}
            >
              {scale === "linear" ? "Use logarithmic scale" : "Use linear scale"}
            </button>
            <span className="font-mono text-[0.65rem] text-muted-foreground tnum">
              C {deferred.curve.constant} / L3 {deferred.curve.cubic} / L2 {deferred.curve.quadratic}{" "}
              / L {deferred.curve.linear}
            </span>
          </div>
          <div className="grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-5">
            {benchmarks.map((item) => (
              <div key={item.level} className="border-r border-b border-border px-4 py-3 last:border-r-0">
                <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  Level {item.level}
                </span>
                <strong className="mt-1 block font-mono text-sm tnum">{compact(item.xp)}</strong>
                <small className="font-mono text-[0.65rem] text-muted-foreground tnum">
                  +{compact(xpBetweenLevels(Math.max(0, item.level - 1), deferred))}
                </small>
              </div>
            ))}
          </div>
          {!diagnostics.strictlyIncreasing && (
            <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-warning">
              This curve contains {diagnostics.duplicateLevels.length} zero-cost level transition
              {diagnostics.duplicateLevels.length === 1 ? "" : "s"}. Increase the coefficients or
              reduce rounding.
            </p>
          )}
        </>
      )}
    </div>
  );
}
