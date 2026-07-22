import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const require = createRequire(`${process.cwd()}/package.json`);
const { GlobalFonts } = require("@napi-rs/canvas") as {
  GlobalFonts: { has(family: string): boolean; registerFromPath(path: string, alias?: string): unknown };
};
const fontFiles = [
  ["@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "Inochi Sans"],
  ["@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", "Inochi Mono"],
] as const;

for (const [file, family] of fontFiles) {
  if (!GlobalFonts.has(family) && !GlobalFonts.registerFromPath(require.resolve(file), family)) {
    throw new Error(`Unable to register bundled rank-card font: ${family}`);
  }
}

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
  ctx.roundRect(4, 4, width - 8, height - 8, 28);
  ctx.clip();

  ctx.fillStyle = "#111418";
  ctx.fillRect(0, 0, width, height);
  if (input.backgroundUrl) {
    try {
      const background = await loadImage(input.backgroundUrl);
      ctx.drawImage(background, ...coverCrop(background, 0, 0, width, height));
      const overlay = Math.round(Math.max(0, Math.min(0.95, input.backgroundOverlay ?? 0.86)) * 255).toString(16).padStart(2, "0");
      ctx.fillStyle = `#080b0e${overlay}`;
      ctx.fillRect(0, 0, width, height);
    } catch {}
  }

  if ((input.surface ?? "technical") === "technical") {
    // A quiet wave over a technical grid gives the card its own monochrome texture.
    ctx.strokeStyle = "#ffffff0d";
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
    ctx.strokeStyle = "#ffffff12";
    ctx.lineWidth = 2;
    for (const offset of [-28, 0, 28]) {
      ctx.beginPath();
      ctx.moveTo(220, 230 + offset);
      ctx.bezierCurveTo(410, 115 + offset, 670, 345 + offset, 980, 145 + offset);
      ctx.stroke();
    }
  }

  const accent = /^#[0-9a-f]{6}$/i.test(input.accentColor ?? "") ? input.accentColor! : "#8ba8ff";
  const avatarRadius = input.avatarShape === "circle" ? 94 : input.avatarShape === "square" ? 12 : 40;
  ctx.fillStyle = "#090b0ee8";
  ctx.beginPath();
  ctx.roundRect(24, 30, 216, 240, 48);
  ctx.fill();
  ctx.strokeStyle = "#ffffff24";
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
    ctx.fillStyle = "#242932";
    ctx.beginPath();
    ctx.roundRect(38, 44, 188, 188, avatarRadius);
    ctx.fill();
    ctx.fillStyle = "#f4f6f8";
    ctx.font = "700 68px 'Inochi Sans'";
    ctx.textAlign = "center";
    ctx.fillText(input.username.trim().slice(0, 1).toUpperCase() || "?", 132, 162);
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(78, 247, 108, 5, 3);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#aab0b8";
  ctx.font = "600 15px 'Inochi Mono'";
  ctx.fillText("INOCHI  /  MEMBER", 278, 48);

  ctx.fillStyle = "#f7f8fa";
  ctx.font = "700 37px 'Inochi Sans'";
  ctx.fillText(ellipsize(ctx, input.username, 370), 278, 99);

  ctx.textAlign = "right";
  ctx.fillStyle = "#9299a3";
  ctx.font = "600 14px 'Inochi Mono'";
  ctx.fillText("LEVEL", 764, 45);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 50px 'Inochi Sans'";
  ctx.fillText(exact(input.level), 764, 96);
  ctx.fillStyle = "#9299a3";
  ctx.font = "600 14px 'Inochi Mono'";
  ctx.fillText("RANK", 900, 45);
  ctx.fillStyle = "#d5d9df";
  ctx.font = "700 31px 'Inochi Sans'";
  ctx.fillText(`#${exact(input.rank)}`, 900, 88);

  const remaining = Math.max(0, input.nextLevelXp - input.xp);
  ctx.textAlign = "left";
  ctx.fillStyle = "#9299a3";
  ctx.font = "600 13px 'Inochi Mono'";
  ctx.fillText("TOTAL XP", 278, 139);
  ctx.fillStyle = "#f4f6f8";
  ctx.font = "700 23px 'Inochi Sans'";
  ctx.fillText(exact(input.xp), 278, 169);
  ctx.fillStyle = "#9299a3";
  ctx.font = "600 13px 'Inochi Mono'";
  ctx.fillText("XP TO NEXT LEVEL", 500, 139);
  ctx.fillStyle = "#f4f6f8";
  ctx.font = "700 23px 'Inochi Sans'";
  ctx.fillText(exact(remaining), 500, 169);

  const barX = 278;
  const barY = 202;
  const barWidth = 622;
  const barHeight = 26;
  const progress = input.xp > 0 && Number.isFinite(input.progress) ? Math.max(0, Math.min(1, input.progress)) : 0;
  ctx.fillStyle = "#ffffff1c";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fill();
  if (progress > 0) {
    if ((input.progressStyle ?? "glow") === "glow") {
      ctx.save();
      ctx.fillStyle = `${accent}38`;
      ctx.beginPath();
      ctx.roundRect(barX - 3, barY - 3, barWidth * progress + 6, barHeight + 6, (barHeight + 6) / 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);
    ctx.restore();
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#aab0b8";
  ctx.font = "500 14px 'Inochi Mono'";
  ctx.fillText(`${exact(input.xp - input.currentLevelXp)} / ${exact(input.nextLevelXp - input.currentLevelXp)} XP`, barX, 258);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(progress * 100)}%`, 900, 258);

  ctx.restore();
  ctx.strokeStyle = "#ffffff24";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, height - 8, 28);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

function gameCanvas(label: string, prompt: string, detail: string): Buffer {
  const canvas = createCanvas(960, 360);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#151515";
  ctx.fillRect(0, 0, 960, 360);
  ctx.strokeStyle = "#3b3b3b";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 958, 358);
  ctx.fillStyle = "#8d8d8d";
  ctx.font = "500 18px 'Inochi Mono'";
  ctx.textAlign = "left";
  ctx.fillText(`INOCHI / ${label}`, 55, 65);
  ctx.fillStyle = "#f4f4f4";
  ctx.font = `700 ${prompt.length > 18 ? 55 : 76}px 'Inochi Sans'`;
  ctx.textAlign = "center";
  ctx.fillText(prompt, 480, 205);
  ctx.fillStyle = "#8d8d8d";
  ctx.font = "500 17px 'Inochi Mono'";
  ctx.fillText(detail, 480, 300);
  return canvas.toBuffer("image/png");
}

export function renderWordGameImage(word: string) {
  return gameCanvas("TYPE THE WORD", word.toUpperCase(), "TYPE IT FIRST · UP TO THREE PLACES");
}

export function renderMathGameImage(expression: string) {
  return gameCanvas("SOLVE THE EQUATION", expression, "SEND THE INTEGER ANSWER · UP TO THREE PLACES");
}
