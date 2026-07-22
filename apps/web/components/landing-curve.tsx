"use client";

import { useState } from "react";
import { defaultGuildSettings } from "@inochi/core";
import { CurvePreview } from "./curve-preview";

export function LandingCurve() {
  const [settings, setSettings] = useState(defaultGuildSettings);
  const update = (key: "cubic" | "quadratic" | "linear", value: number) => setSettings((current) => ({ ...current, curve: { ...current.curve, [key]: value } }));
  return <div className="playground-grid">
    <div className="playground-copy"><span className="eyebrow mono">Curve laboratory</span><h2>See every level before you commit.</h2><p>Inochi derives levels from one shared curve used by the bot, dashboard, API, imports, and rank cards. Adjust the shape locally; nothing here is saved.</p>
      <div className="playground-controls">
        <label>Cubic <input type="range" min="0" max="5" step=".1" value={settings.curve.cubic} onChange={(event) => update("cubic", Number(event.target.value))} /><strong>{settings.curve.cubic}</strong></label>
        <label>Quadratic <input type="range" min="0" max="150" step="5" value={settings.curve.quadratic} onChange={(event) => update("quadratic", Number(event.target.value))} /><strong>{settings.curve.quadratic}</strong></label>
        <label>Linear <input type="range" min="0" max="500" step="10" value={settings.curve.linear} onChange={(event) => update("linear", Number(event.target.value))} /><strong>{settings.curve.linear}</strong></label>
      </div>
    </div>
    <CurvePreview settings={settings} compactView />
  </div>;
}
