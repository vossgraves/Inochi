import type { GuildSettings } from "./settings";

export function xpForLevel(level: number, settings: GuildSettings): number {
  const safeLevel = Math.max(0, Math.min(Math.floor(level), settings.curve.maxLevel));
  const { cubic, quadratic, linear, rounding } = settings.curve;
  const raw = cubic * safeLevel ** 3 + quadratic * safeLevel ** 2 + linear * safeLevel;
  return rounding > 1 ? Math.round(raw / rounding) * rounding : Math.round(raw);
}

export function levelForXp(xp: number, settings: GuildSettings): number {
  const value = Math.max(0, xp);
  let low = 0;
  let high = settings.curve.maxLevel;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (xpForLevel(middle, settings) <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function progressForXp(xp: number, settings: GuildSettings) {
  const level = levelForXp(xp, settings);
  const current = xpForLevel(level, settings);
  const next = level >= settings.curve.maxLevel ? current : xpForLevel(level + 1, settings);
  const progress = next === current ? 1 : Math.max(0, Math.min(1, (xp - current) / (next - current)));
  return { level, current, next, progress, remaining: Math.max(0, next - xp) };
}
