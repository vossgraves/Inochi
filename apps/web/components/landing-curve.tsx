"use client";

import { useState } from "react";
import { defaultGuildSettings } from "@inochi/core";
import { CurvePreview } from "./curve-preview";
import { Slider } from "@/components/ui/slider";

const controls = [
  { key: "cubic", label: "Cubic", max: 5, step: 0.1 },
  { key: "quadratic", label: "Quadratic", max: 150, step: 5 },
  { key: "linear", label: "Linear", max: 500, step: 10 },
] as const;

/*
  The three hand-rolled input[type=range] elements here each carried an inline
  --range-progress custom property recomputed on every change to fake a filled
  track. Radix Slider renders a real range, so that is gone.
*/
export function LandingCurve() {
  const [settings, setSettings] = useState(defaultGuildSettings);
  const update = (key: (typeof controls)[number]["key"], value: number) =>
    setSettings((current) => ({ ...current, curve: { ...current.curve, [key]: value } }));

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
      <div className="lg:col-span-5">
        <h2 className="max-w-[18ch] text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          See every level before you commit.
        </h2>
        <p className="mt-5 max-w-[52ch] leading-relaxed text-muted-foreground">
          Inochi derives levels from one curve, shared by the bot, dashboard, API, importers, and
          rank cards. Move the coefficients and watch the thresholds change. Nothing here is saved.
        </p>
        <div className="mt-10 grid gap-6">
          {controls.map(({ key, label, max, step }) => (
            <div key={key} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-4">
              <span className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
                {label}
              </span>
              <Slider
                aria-label={`${label} coefficient`}
                min={0}
                max={max}
                step={step}
                value={[settings.curve[key]]}
                onValueChange={([value]) => update(key, value ?? 0)}
              />
              <strong className="text-right font-mono text-sm tnum">{settings.curve[key]}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-7">
        <CurvePreview settings={settings} compactView />
      </div>
    </div>
  );
}
