import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const require = createRequire(`${process.cwd()}/package.json`);
const { GlobalFonts } = require("@napi-rs/canvas") as {
  GlobalFonts: { has(family: string): boolean; registerFromPath(path: string, alias?: string): unknown };
};
// Satoshi is vendored beside this package rather than pulled from a registry so
// the rendered card uses the same display face as the dashboard. JetBrains Mono
// is shared with the web app for the same reason: every numeral in the product,
// on screen or in the PNG, is the same tabular face.
const satoshiPath = new URL("../fonts/Satoshi-Variable.woff2", import.meta.url).pathname;
const fontFiles = [
  [satoshiPath, "Inochi Sans"],
  [
    require.resolve("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"),
    "Inochi Mono",
  ],
] as const;

for (const [file, family] of fontFiles) {
  if (!GlobalFonts.has(family) && !GlobalFonts.registerFromPath(file, family)) {
    throw new Error(`Unable to register bundled rank-card font: ${family}`);
  }
}

/*
  Ink and Vermilion, matching apps/web/app/globals.css. The card used to be a
  cool blue-grey panel with a #8ba8ff accent and rounded 28px corners; it is now
  the same sumi field and 朱 accent as the dashboard, with near-sharp corners.
*/
const INK = "#14110f";
const INK_PANEL = "#1c1917";
const PAPER = "#f4f1ea";
const PAPER_DIM = "#cfc9c0";
const MUTED = "#a8a199";
const MUTED_DIM = "#8a837c";
const HAIRLINE = "#ffffff1f";
const HAIRLINE_FAINT = "#ffffff0d";
const VERMILION = "#d33c1c";
const CARD_RADIUS = 6;

export interface RankCardInput {
  username: string;
  avatarUrl: string;
  rank: number;
  level: number;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  accentColor?: string;
  backgroundUrl?: string;
  backgroundOverlay?: number;
  avatarShape?: "rounded" | "circle" | "square";
  surface?: "technical" | "clean";
  progressStyle?: "solid" | "glow";
}

function exact(value: number) {
  return Math.max(0, Number.isFinite(value) ? Math.round(value) : 0).toLocaleString("en-US");
}

function coverCrop(image: { width: number; height: number }, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  return [(image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height] as const;
}

function ellipsize(ctx: { measureText(text: string): { width: number } }, value: string, maxWidth: number) {
  if (ctx.measureText(value).width <= maxWidth) return value;
  const ellipsis = "...";
  let end = value.length;
  while (end > 0 && ctx.measureText(value.slice(0, end) + ellipsis).width > maxWidth) end--;
  return value.slice(0, end) + ellipsis;
}

export async function renderRankCard(input: RankCardInput): Promise<Buffer> {
  const width = 960;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, height - 8, CARD_RADIUS);
  ctx.clip();

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  if (input.backgroundUrl) {
    try {
      const background = await loadImage(input.backgroundUrl);
      ctx.drawImage(background, ...coverCrop(background, 0, 0, width, height));
      const overlay = Math.round(Math.max(0, Math.min(0.95, input.backgroundOverlay ?? 0.86)) * 255).toString(16).padStart(2, "0");
      ctx.fillStyle = `${INK}${overlay}`;
      ctx.fillRect(0, 0, width, height);
    } catch {}
  }

  if ((input.surface ?? "technical") === "technical") {
    // A plain measuring grid. The three bezier "pulse" waves that used to cross
    // it are gone; the texture is rules, not decoration.
    ctx.strokeStyle = HAIRLINE_FAINT;
    ctx.lineWidth = 1;
    for (let x = 270; x < width; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 20; y < height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(250, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  const accent = /^#[0-9a-f]{6}$/i.test(input.accentColor ?? "") ? input.accentColor! : VERMILION;
  const avatarRadius = input.avatarShape === "circle" ? 94 : input.avatarShape === "square" ? 0 : 6;
  ctx.fillStyle = INK_PANEL;
  ctx.beginPath();
  ctx.roundRect(24, 30, 216, 240, CARD_RADIUS);
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  try {
    const avatar = await loadImage(input.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(38, 44, 188, 188, avatarRadius);
    ctx.clip();
    ctx.drawImage(avatar, ...coverCrop(avatar, 38, 44, 188, 188));
    ctx.restore();
  } catch {
    ctx.fillStyle = "#262220";
    ctx.beginPath();
    ctx.roundRect(38, 44, 188, 188, avatarRadius);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.font = "700 68px 'Inochi Sans'";
    ctx.textAlign = "center";
    ctx.fillText(input.username.trim().slice(0, 1).toUpperCase() || "?", 132, 162);
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(78, 247, 108, 5, 3);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = "600 15px 'Inochi Mono'";
  ctx.fillText("INOCHI  /  MEMBER", 278, 48);

  ctx.fillStyle = PAPER;
  ctx.font = "700 37px 'Inochi Sans'";
  ctx.fillText(ellipsize(ctx, input.username, 370), 278, 99);

  ctx.textAlign = "right";
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "600 14px 'Inochi Mono'";
  ctx.fillText("LEVEL", 764, 45);
  ctx.fillStyle = PAPER;
  ctx.font = "800 50px 'Inochi Sans'";
  ctx.fillText(exact(input.level), 764, 96);
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "600 14px 'Inochi Mono'";
  ctx.fillText("RANK", 900, 45);
  ctx.fillStyle = PAPER_DIM;
  ctx.font = "700 31px 'Inochi Sans'";
  ctx.fillText(`#${exact(input.rank)}`, 900, 88);

  const remaining = Math.max(0, input.nextLevelXp - input.xp);
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "600 13px 'Inochi Mono'";
  ctx.fillText("TOTAL XP", 278, 139);
  ctx.fillStyle = PAPER;
  ctx.font = "700 23px 'Inochi Sans'";
  ctx.fillText(exact(input.xp), 278, 169);
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "600 13px 'Inochi Mono'";
  ctx.fillText("XP TO NEXT LEVEL", 500, 139);
  ctx.fillStyle = PAPER;
  ctx.font = "700 23px 'Inochi Sans'";
  ctx.fillText(exact(remaining), 500, 169);

  const barX = 278;
  const barY = 202;
  const barWidth = 622;
  const barHeight = 26;
  const progress = input.xp > 0 && Number.isFinite(input.progress) ? Math.max(0, Math.min(1, input.progress)) : 0;
  // The track is a squared-off trough rather than a pill, matching the 2px
  // radius the rest of the product uses.
  ctx.fillStyle = "#ffffff14";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, 3);
  ctx.fill();
  if (progress > 0) {
    // progressStyle stays honoured because it is a saved guild setting, but the
    // halo is much tighter than the old bloom.
    if ((input.progressStyle ?? "glow") === "glow") {
      ctx.save();
      ctx.fillStyle = `${accent}2b`;
      ctx.beginPath();
      ctx.roundRect(barX - 2, barY - 2, barWidth * progress + 4, barHeight + 4, 4);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 3);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);
    ctx.restore();
  }

  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = "500 14px 'Inochi Mono'";
  ctx.fillText(`${exact(input.xp - input.currentLevelXp)} / ${exact(input.nextLevelXp - input.currentLevelXp)} XP`, barX, 258);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(progress * 100)}%`, 900, 258);

  ctx.restore();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, height - 8, CARD_RADIUS);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

function gameCanvas(label: string, prompt: string, detail: string): Buffer {
  const canvas = createCanvas(960, 360);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, 960, 360);
  ctx.strokeStyle = "#463f3a";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 958, 358);
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "500 18px 'Inochi Mono'";
  ctx.textAlign = "left";
  ctx.fillText(`INOCHI / ${label}`, 55, 65);
  ctx.fillStyle = PAPER;
  ctx.font = `700 ${prompt.length > 18 ? 55 : 76}px 'Inochi Sans'`;
  ctx.textAlign = "center";
  ctx.fillText(prompt, 480, 205);
  ctx.fillStyle = MUTED_DIM;
  ctx.font = "500 17px 'Inochi Mono'";
  ctx.fillText(detail, 480, 300);
  // One vermilion rule under the prompt, so the game images carry the accent too.
  ctx.fillStyle = VERMILION;
  ctx.fillRect(430, 240, 100, 3);
  return canvas.toBuffer("image/png");
}

export function renderWordGameImage(word: string) {
  return gameCanvas("TYPE THE WORD", word.toUpperCase(), "TYPE IT FIRST · UP TO THREE PLACES");
}

export function renderMathGameImage(expression: string) {
  return gameCanvas("SOLVE THE EQUATION", expression, "SEND THE INTEGER ANSWER · UP TO THREE PLACES");
}
