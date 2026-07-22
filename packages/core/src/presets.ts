import type { GuildSettings } from "./settings";

export type LevelingPresetName = "inochi" | "lurkr" | "mee6" | "amari";
export type LevelingPreset = Pick<GuildSettings, "gain"> & {
  label: string;
  description: string;
  globalMultiplier: number;
  curve: Omit<GuildSettings["curve"], "maxLevel">;
};

export const levelingPresets: Record<LevelingPresetName, LevelingPreset> = {
  inochi: {
    label: "Inochi",
    description: "50-100 XP every 60s",
    gain: { min: 50, max: 100, cooldownSeconds: 60 },
    globalMultiplier: 1,
    curve: { constant: 0, cubic: 1, quadratic: 50, linear: 100, rounding: 100 },
  },
  lurkr: {
    label: "Lurkr",
    description: "15-40 XP every 60s",
    gain: { min: 15, max: 40, cooldownSeconds: 60 },
    globalMultiplier: 1,
    curve: { constant: 150, cubic: 0, quadratic: 50, linear: -100, rounding: 1 },
  },
  mee6: {
    label: "MEE6",
    description: "15-25 XP every 60s",
    gain: { min: 15, max: 25, cooldownSeconds: 60 },
    globalMultiplier: 1,
    curve: { constant: 0, cubic: 5 / 3, quadratic: 22.5, linear: 455 / 6, rounding: 1 },
  },
  amari: {
    label: "Amari",
    description: "1 XP every 8s",
    gain: { min: 1, max: 1, cooldownSeconds: 8 },
    globalMultiplier: 1,
    curve: { constant: 55, cubic: 0, quadratic: 20, linear: -40, rounding: 1 },
  },
};

export function applyLevelingPreset(settings: GuildSettings, name: LevelingPresetName): GuildSettings {
  const preset = levelingPresets[name];
  return {
    ...settings,
    gain: { ...preset.gain },
    curve: { ...preset.curve, maxLevel: settings.curve.maxLevel },
    multipliers: { ...settings.multipliers, global: preset.globalMultiplier },
  };
}

export function detectLevelingPreset(settings: GuildSettings): LevelingPresetName | "custom" {
  for (const [name, preset] of Object.entries(levelingPresets) as [LevelingPresetName, LevelingPreset][]) {
    const curveMatches = (Object.keys(preset.curve) as (keyof typeof preset.curve)[])
      .every((key) => Math.abs(settings.curve[key] - preset.curve[key]) < 0.000_001);
    if (curveMatches && settings.gain.min === preset.gain.min && settings.gain.max === preset.gain.max
      && settings.gain.cooldownSeconds === preset.gain.cooldownSeconds && settings.multipliers.global === preset.globalMultiplier) return name;
  }
  return "custom";
}
