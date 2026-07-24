import { createCanvas } from "@napi-rs/canvas";
import type { InochiEmoji } from "./emojis";

const tones: Record<InochiEmoji, [string, string]> = {
  success: ["#47d18c", "#25d0f5"], warning: ["#ffb84d", "#ff77b2"], error: ["#ff747d", "#ff5da2"], info: ["#25d0f5", "#7c8dff"],
  settings: ["#b8aaff", "#25d0f5"], xp: ["#25d0f5", "#7c5cff"], levelup: ["#ff77b2", "#ffb84d"], rank: ["#ffb84d", "#ff77b2"],
  leaderboard: ["#b8aaff", "#25d0f5"], games: ["#ff77b2", "#7c5cff"], security: ["#47d18c", "#25d0f5"], backup: ["#25d0f5", "#47d18c"], coinflip: ["#ffb84d", "#b8aaff"],
};

export function renderEmoji(name: InochiEmoji) {
  const [primary, secondary] = tones[name];
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const line = (points: [number, number][], close = false) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath();
    ctx.stroke();
  };

  const background = ctx.createRadialGradient(38, 28, 4, 64, 64, 92);
  background.addColorStop(0, "#293064");
  background.addColorStop(.52, "#13182f");
  background.addColorStop(1, "#080a18");
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 30);
  ctx.fill();

  const orbit = ctx.createLinearGradient(18, 16, 108, 112);
  orbit.addColorStop(0, primary);
  orbit.addColorStop(1, secondary);
  ctx.strokeStyle = orbit;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(64, 64, 49, -.45, Math.PI * 1.77);
  ctx.stroke();
  ctx.shadowColor = primary;
  ctx.shadowBlur = 13;
  ctx.strokeStyle = "#f8f8ff";
  ctx.fillStyle = "#f8f8ff";
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";

  if (name === "success") line([[39, 65], [56, 82], [90, 44]]);
  if (name === "warning") { line([[64, 34], [94, 88], [34, 88]], true); ctx.lineWidth = 7; line([[64, 51], [64, 69]]); ctx.beginPath(); ctx.arc(64, 80, 4, 0, Math.PI * 2); ctx.fill(); }
  if (name === "error") { line([[43, 43], [85, 85]]); line([[85, 43], [43, 85]]); }
  if (name === "info") { ctx.beginPath(); ctx.arc(64, 43, 5, 0, Math.PI * 2); ctx.fill(); line([[64, 59], [64, 86]]); }
  if (name === "settings") { ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(64, 64, 18, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(64, 64, 5, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line([[64 + Math.cos(a) * 23, 64 + Math.sin(a) * 23], [64 + Math.cos(a) * 31, 64 + Math.sin(a) * 31]]); } }
  if (name === "xp") { line([[70, 29], [43, 65], [62, 65], [54, 99], [87, 56], [67, 56]], true); ctx.lineWidth = 5; ctx.strokeStyle = secondary; line([[28, 39], [28, 55]]); line([[20, 47], [36, 47]]); }
  if (name === "levelup") { line([[64, 91], [64, 37]]); line([[42, 57], [64, 35], [86, 57]]); ctx.strokeStyle = secondary; ctx.lineWidth = 5; line([[42, 86], [64, 66], [86, 86]]); }
  if (name === "rank") { ctx.beginPath(); ctx.arc(64, 55, 22, 0, Math.PI * 2); ctx.stroke(); line([[48, 73], [42, 98], [64, 85], [86, 98], [80, 73]]); ctx.font = "800 28px Inochi Sans, sans-serif"; ctx.textAlign = "center"; ctx.fillText("1", 64, 65); }
  if (name === "leaderboard") { ctx.lineWidth = 6; line([[36, 88], [36, 67], [52, 67], [52, 88]], true); line([[56, 88], [56, 43], [72, 43], [72, 88]], true); line([[76, 88], [76, 56], [92, 56], [92, 88]], true); }
  if (name === "games") { ctx.lineWidth = 7; ctx.beginPath(); ctx.roundRect(29, 45, 70, 43, 17); ctx.stroke(); line([[45, 58], [45, 74]]); line([[37, 66], [53, 66]]); ctx.beginPath(); ctx.arc(80, 61, 4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(89, 72, 4, 0, Math.PI * 2); ctx.fill(); }
  if (name === "security") { line([[64, 31], [92, 42], [88, 72], [64, 96], [40, 72], [36, 42]], true); ctx.lineWidth = 6; line([[50, 64], [60, 74], [80, 52]]); }
  if (name === "backup") { ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(64, 65, 29, -.2, Math.PI * 1.55); ctx.stroke(); line([[34, 45], [34, 69], [52, 58]]); ctx.strokeStyle = secondary; line([[64, 50], [64, 67], [77, 75]]); }
  if (name === "coinflip") { ctx.beginPath(); ctx.arc(64, 64, 29, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = secondary; ctx.beginPath(); ctx.arc(64, 64, 20, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = "#f8f8ff"; ctx.lineWidth = 5; line([[45, 65], [54, 65], [59, 54], [66, 77], [72, 46], [78, 65], [84, 65]]); }

  ctx.shadowBlur = 0;
  ctx.fillStyle = secondary;
  ctx.beginPath();
  ctx.arc(102, 25, 5, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}
