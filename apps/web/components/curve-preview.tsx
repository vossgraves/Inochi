"use client";

import { useDeferredValue, useId, useState } from "react";
import type { CSSProperties } from "react";
import { analyzeCurve, curveBenchmarks, xpBetweenLevels, xpForLevel } from "@inochi/core";
import type { GuildSettings } from "@inochi/core";

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function CurvePreview({ settings, compactView = false }: { settings: GuildSettings; compactView?: boolean }) {
  const id = useId();
  const deferred = useDeferredValue(settings);
  const [mode, setMode] = useState<"total" | "step">("total");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [selected, setSelected] = useState(Math.min(10, deferred.curve.maxLevel));
  const configuredMaxLevel = Math.max(1, deferred.curve.maxLevel);
  const maxLevel = Math.min(150, configuredMaxLevel);
  const level = Math.min(selected, maxLevel);
  const levels = Array.from({ length: maxLevel }, (_, index) => index + 1);
  const values = levels.map((point) => mode === "total" ? xpForLevel(point, deferred) : xpBetweenLevels(Math.max(0, point - 1), deferred));
  const transformed = values.map((value) => scale === "log" ? Math.log10(Math.max(1, value)) : value);
  const maximum = Math.max(1, ...transformed);
  const points = levels.map((point, index) => {
    const x = ((point - 1) / Math.max(1, maxLevel - 1)) * 100;
    const y = 100 - transformed[index]! / maximum * 88;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const selectedValue = mode === "total" ? xpForLevel(level, deferred) : xpBetweenLevels(Math.max(0, level - 1), deferred);
  const selectedX = ((level - 1) / Math.max(1, maxLevel - 1)) * 100;
  const selectedYValue = scale === "log" ? Math.log10(Math.max(1, selectedValue)) : selectedValue;
  const selectedY = 100 - selectedYValue / maximum * 88;
  const diagnostics = analyzeCurve(deferred);
  const benchmarkLevels = [...new Set([1, 5, 10, 25, 50, 75, 100, 125, 150, maxLevel].filter((value) => value <= maxLevel))];
  const benchmarks = curveBenchmarks(deferred, benchmarkLevels);
  const markerStyle = { "--curve-x": `${selectedX}%`, "--curve-y": `${selectedY / 106 * 100}%` } as CSSProperties;
  const sliderStyle = { "--range-progress": `${selectedX}%` } as CSSProperties;

  return <div className={`curve-card ${compactView ? "curve-card-compact" : ""}`}>
    <div className="curve-toolbar">
      <div><span className="kicker mono">Live curve</span><h3>Progression geometry</h3></div>
      <div className="segmented" aria-label="Curve display mode">
        <button type="button" className={mode === "total" ? "selected" : ""} onClick={() => setMode("total")}>Total XP</button>
        <button type="button" className={mode === "step" ? "selected" : ""} onClick={() => setMode("step")}>Per level</button>
      </div>
    </div>
    <div className="curve-plot" aria-label={`${mode === "total" ? "Total XP" : "XP per level"} curve through level ${maxLevel}`}>
      <div className="curve-canvas" style={markerStyle}><svg viewBox="0 0 100 106" role="img" preserveAspectRatio="none">
          <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".28"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
          {[20, 40, 60, 80].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="curve-gridline" />)}
          <polygon points={`0,100 ${points} 100,100`} fill={`url(#${id}-fill)`} />
          <polyline points={points} className="curve-line" />
          <line x1={selectedX} x2={selectedX} y1="8" y2="100" className="curve-cursor" />
        </svg><i className="curve-marker" /></div>
      <div className="curve-axis"><span>LV 1</span><span>LV {maxLevel}</span></div>
    </div>
    <div className="curve-selection">
      <label htmlFor={`${id}-level`}>Level <strong>{level}</strong></label>
      <input id={`${id}-level`} type="range" min="1" max={maxLevel} step="1" value={level} style={sliderStyle} onChange={(event) => setSelected(Number(event.target.value))} />
      <div className="curve-reading"><strong>{selectedValue.toLocaleString()} XP</strong><span>{mode === "total" ? "total threshold" : "from previous level"}</span></div>
    </div>
    {!compactView && <>
      <div className="curve-options"><button type="button" className="text-button" onClick={() => setScale((value) => value === "linear" ? "log" : "linear")}>{scale === "linear" ? "Use logarithmic scale" : "Use linear scale"}</button><span className="mono status">C {deferred.curve.constant} · L³ {deferred.curve.cubic} · L² {deferred.curve.quadratic} · L {deferred.curve.linear}</span></div>
      <div className="benchmark-grid">{benchmarks.map((item) => <div key={item.level}><span>Level {item.level}</span><strong>{compact(item.xp)}</strong><small>+{compact(xpBetweenLevels(Math.max(0, item.level - 1), deferred))}</small></div>)}</div>
      {!diagnostics.strictlyIncreasing && <div className="notice warning">This curve contains {diagnostics.duplicateLevels.length} zero-cost level transition{diagnostics.duplicateLevels.length === 1 ? "" : "s"}. Increase the coefficients or reduce rounding.</div>}
    </>}
  </div>;
}
