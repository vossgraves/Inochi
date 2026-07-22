import type { GuildSettings } from "./settings";

export interface CurveBenchmark {
  level: number;
  xp: number;
  xpToNextLevel: number;
}

export interface CurveAnalysis {
  strictlyIncreasing: boolean;
  duplicateLevels: number[];
  allZero: boolean;
}

function normalizedLevel(level: number, settings: GuildSettings): number {
  return Number.isFinite(level) ? Math.max(0, Math.min(Math.floor(level), settings.curve.maxLevel)) : 0;
}

function normalizedXp(xp: number): number {
  return Number.isFinite(xp) ? Math.max(0, xp) : 0;
}

export function xpForLevel(level: number, settings: GuildSettings): number {
  const safeLevel = normalizedLevel(level, settings);
  if (safeLevel === 0) return 0;
  const { constant, cubic, quadratic, linear, rounding } = settings.curve;
  const raw = constant + cubic * safeLevel ** 3 + quadratic * safeLevel ** 2 + linear * safeLevel;
  const rounded = rounding > 1 ? Math.round(raw / rounding) * rounding : Math.round(raw);
  return Math.max(0, rounded);
}

export function xpBetweenLevels(level: number, settings: GuildSettings): number {
  const safeLevel = normalizedLevel(level, settings);
  if (safeLevel >= settings.curve.maxLevel) return 0;
  return Math.max(0, xpForLevel(safeLevel + 1, settings) - xpForLevel(safeLevel, settings));
}

export function curveBenchmarks(settings: GuildSettings, levels: readonly number[]): CurveBenchmark[] {
  return levels.map((level) => {
    const safeLevel = normalizedLevel(level, settings);
    return { level: safeLevel, xp: xpForLevel(safeLevel, settings), xpToNextLevel: xpBetweenLevels(safeLevel, settings) };
  });
}

export function analyzeCurve(settings: GuildSettings): CurveAnalysis {
  const benchmarks = curveBenchmarks(settings, Array.from({ length: settings.curve.maxLevel + 1 }, (_, level) => level));
  const duplicateLevels = benchmarks.slice(1).filter((benchmark, index) => benchmark.xp <= benchmarks[index]!.xp).map((benchmark) => benchmark.level);
  return {
    strictlyIncreasing: duplicateLevels.length === 0,
    duplicateLevels,
    allZero: benchmarks.every((benchmark) => benchmark.xp === 0),
  };
}

export function levelForXp(xp: number, settings: GuildSettings): number {
  const value = normalizedXp(xp);
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
  const value = normalizedXp(xp);
  const level = levelForXp(value, settings);
  const current = xpForLevel(level, settings);
  const next = level >= settings.curve.maxLevel ? current : xpForLevel(level + 1, settings);
  const progress = next === current ? 1 : Math.max(0, Math.min(1, (value - current) / (next - current)));
  return { level, current, next, progress, remaining: Math.max(0, next - value) };
}
