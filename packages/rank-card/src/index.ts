import { createCanvas, loadImage } from "@napi-rs/canvas";

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
}

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export async function renderRankCard(input: RankCardInput): Promise<Buffer> {
  const width = 960;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#171717";
  ctx.fillRect(0, 0, width, height);
  if (input.backgroundUrl) {
    try {
      const background = await loadImage(input.backgroundUrl);
      ctx.drawImage(background, 0, 0, width, height);
      ctx.fillStyle = "#101010b8";
      ctx.fillRect(0, 0, width, height);
    } catch {}
  }
  ctx.strokeStyle = "#363636";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  ctx.fillStyle = "#242424";
  ctx.beginPath();
  ctx.arc(146, 150, 92, 0, Math.PI * 2);
  ctx.fill();

  try {
    const avatar = await loadImage(input.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(146, 150, 80, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 66, 70, 160, 160);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#737373";
    ctx.font = "600 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(input.username.slice(0, 1).toUpperCase(), 146, 172);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#8d8d8d";
  ctx.font = "500 18px monospace";
  ctx.fillText("INOCHI / MEMBER RECORD", 278, 65);

  ctx.fillStyle = "#f4f4f4";
  ctx.font = "600 38px sans-serif";
  ctx.fillText(input.username.slice(0, 24), 278, 116);

  ctx.font = "500 21px monospace";
  ctx.fillStyle = "#a3a3a3";
  ctx.fillText(`RANK  #${input.rank}`, 278, 158);
  ctx.fillText(`LEVEL  ${input.level}`, 478, 158);
  ctx.textAlign = "right";
  ctx.fillText(`${compact(input.xp)} XP`, 900, 158);

  const barX = 278;
  const barY = 195;
  const barWidth = 622;
  ctx.fillStyle = "#333333";
  ctx.fillRect(barX, barY, barWidth, 15);
  ctx.fillStyle = input.accentColor ?? "#f2f2f2";
  ctx.fillRect(barX, barY, Math.max(5, barWidth * Math.max(0, Math.min(1, input.progress))), 15);

  ctx.textAlign = "left";
  ctx.fillStyle = "#858585";
  ctx.font = "500 16px monospace";
  ctx.fillText(`${compact(input.xp - input.currentLevelXp)} / ${compact(input.nextLevelXp - input.currentLevelXp)} XP`, barX, 243);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(input.progress * 100)}%`, 900, 243);

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
  ctx.font = "500 18px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`INOCHI / ${label}`, 55, 65);
  ctx.fillStyle = "#f4f4f4";
  ctx.font = `700 ${prompt.length > 18 ? 55 : 76}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(prompt, 480, 205);
  ctx.fillStyle = "#8d8d8d";
  ctx.font = "500 17px monospace";
  ctx.fillText(detail, 480, 300);
  return canvas.toBuffer("image/png");
}

export function renderWordGameImage(word: string) {
  return gameCanvas("TYPE THE WORD", word.toUpperCase(), "TYPE IT FIRST · UP TO THREE PLACES");
}

export function renderMathGameImage(expression: string) {
  return gameCanvas("SOLVE THE EQUATION", expression, "SEND THE INTEGER ANSWER · UP TO THREE PLACES");
}
