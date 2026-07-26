import { createCanvas } from "@napi-rs/canvas";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { InochiEmoji } from "./emojis";

/*
  Ink and Vermilion, matching apps/web/app/globals.css and the seal mark.

  These render as Discord application emojis and appear inline inside bot
  replies, so they were the last thing still carrying the old violet/cyan/pink
  spectrum after the redesign. Each one is now the same object as the app icon:
  an ink field, a hairline rule, and a paper glyph.

  Colour rules, same as the rest of the product: one accent everywhere, and a
  semantic colour only where the emoji genuinely reports state.
*/
const INK = "#14110f";
const INK_RAISED = "#1c1917";
const PAPER = "#f4f1ea";
const MUTED = "#a8a199";
const VERMILION = "#d33c1c";
const MOSS = "#6f9c68";
const KINCHA = "#c98a2b";
const DANGER = "#de463d";

// The rule colour for each emoji. Only the three state emojis differ.
const accents: Record<InochiEmoji, string> = {
  success: MOSS,
  warning: KINCHA,
  error: DANGER,
  info: VERMILION,
  settings: VERMILION,
  xp: VERMILION,
  levelup: VERMILION,
  rank: VERMILION,
  leaderboard: VERMILION,
  games: VERMILION,
  security: VERMILION,
  backup: VERMILION,
  coinflip: VERMILION,
};

/*
  `t` is animation phase in [0, 1). renderEmoji passes 0, so a static render is
  just the first frame. Only the emojis listed in ANIMATED read it; the rest
  ignore it entirely and render identically at every phase.
*/
export function drawEmoji(ctx: CanvasRenderingContext2D, name: InochiEmoji, t = 0) {
  const accent = accents[name];
  const line = (points: [number, number][], close = false) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
    ctx.stroke();
  };

  ctx.clearRect(0, 0, 128, 128);

  // Seal: ink field, then a hairline rule inset from it. No gradient, no glow.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 8);
  ctx.fill();
  ctx.fillStyle = INK_RAISED;
  ctx.beginPath();
  ctx.roundRect(10, 10, 108, 108, 5);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(10, 10, 108, 108, 5);
  ctx.stroke();

  ctx.strokeStyle = PAPER;
  ctx.fillStyle = PAPER;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Glyph geometry is carried over unchanged; only the palette moved.
  if (name === "success") line([[39, 65], [56, 82], [90, 44]]);
  if (name === "warning") { line([[64, 34], [94, 88], [34, 88]], true); ctx.lineWidth = 7; line([[64, 51], [64, 69]]); ctx.beginPath(); ctx.arc(64, 80, 4, 0, Math.PI * 2); ctx.fill(); }
  if (name === "error") { line([[43, 43], [85, 85]]); line([[85, 43], [43, 85]]); }
  if (name === "info") { ctx.beginPath(); ctx.arc(64, 43, 5, 0, Math.PI * 2); ctx.fill(); line([[64, 59], [64, 86]]); }
  if (name === "settings") { ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(64, 64, 18, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(64, 64, 5, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line([[64 + Math.cos(a) * 23, 64 + Math.sin(a) * 23], [64 + Math.cos(a) * 31, 64 + Math.sin(a) * 31]]); } }
  if (name === "xp") {
    // Rises and settles: a short travel so the bolt reads as gaining, not drifting.
    const lift = Math.sin(t * Math.PI * 2) * 4;
    ctx.save();
    ctx.translate(0, -lift);
    line([[70, 29], [43, 65], [62, 65], [54, 99], [87, 56], [67, 56]], true);
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = accent;
    line([[28, 39], [28, 55]]);
    line([[20, 47], [36, 47]]);
  }
  if (name === "levelup") {
    const lift = Math.sin(t * Math.PI * 2) * 5;
    ctx.save();
    ctx.translate(0, -lift);
    line([[64, 91], [64, 37]]);
    line([[42, 57], [64, 35], [86, 57]]);
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    line([[42, 86], [64, 66], [86, 86]]);
  }
  if (name === "rank") { ctx.beginPath(); ctx.arc(64, 55, 22, 0, Math.PI * 2); ctx.stroke(); line([[48, 73], [42, 98], [64, 85], [86, 98], [80, 73]]); ctx.font = "800 28px Inochi Sans, sans-serif"; ctx.textAlign = "center"; ctx.fillText("1", 64, 65); }
  if (name === "leaderboard") { ctx.lineWidth = 6; line([[36, 88], [36, 67], [52, 67], [52, 88]], true); line([[56, 88], [56, 43], [72, 43], [72, 88]], true); line([[76, 88], [76, 56], [92, 56], [92, 88]], true); }
  if (name === "games") { ctx.lineWidth = 7; ctx.beginPath(); ctx.roundRect(29, 45, 70, 43, 17); ctx.stroke(); line([[45, 58], [45, 74]]); line([[37, 66], [53, 66]]); ctx.beginPath(); ctx.arc(80, 61, 4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(89, 72, 4, 0, Math.PI * 2); ctx.fill(); }
  if (name === "security") { line([[64, 31], [92, 42], [88, 72], [64, 96], [40, 72], [36, 42]], true); ctx.lineWidth = 6; line([[50, 64], [60, 74], [80, 52]]); }
  if (name === "backup") {
    // One full rotation across the loop, which is what a sync arrow should do.
    ctx.save();
    ctx.translate(64, 65);
    ctx.rotate(t * Math.PI * 2);
    ctx.translate(-64, -65);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(64, 65, 29, -.2, Math.PI * 1.55);
    ctx.stroke();
    line([[34, 45], [34, 69], [52, 58]]);
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    line([[64, 50], [64, 67], [77, 75]]);
  }
  if (name === "coinflip") {
    // Squash on the horizontal axis so the coin reads as turning edge-on.
    const turn = Math.abs(Math.cos(t * Math.PI * 2));
    const flat = turn < 0.06;
    ctx.save();
    ctx.translate(64, 64);
    ctx.scale(Math.max(turn, 0.06), 1);
    ctx.translate(-64, -64);
    ctx.beginPath();
    ctx.arc(64, 64, 29, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(64, 64, 20, 0, Math.PI * 2);
    ctx.stroke();
    if (!flat) {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 5;
      line([[45, 65], [54, 65], [59, 54], [66, 77], [72, 46], [78, 65], [84, 65]]);
    }
    ctx.restore();
  }
}

export function renderEmoji(name: InochiEmoji) {
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  drawEmoji(ctx, name, 0);
  return canvas.toBuffer("image/png");
}

/*
  Only these four say something by moving: XP and a level-up rise, a backup
  rotates, a coinflip turns. The rest are labels, and a label that loops
  forever in the middle of a sentence is just noise.
*/
export const ANIMATED_EMOJIS = new Set<InochiEmoji>(["xp", "levelup", "backup", "coinflip"]);

const FRAMES = 24;
const FRAME_DELAY_MS = 60;
// Discord rejects an emoji over 256 KB.
export const EMOJI_SIZE_LIMIT = 256 * 1024;

export function isAnimated(name: InochiEmoji) {
  return ANIMATED_EMOJIS.has(name);
}

export function renderEmojiFrames(name: InochiEmoji, frames = FRAMES) {
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  return Array.from({ length: frames }, (_, index) => {
    drawEmoji(ctx, name, index / frames);
    return ctx.getImageData(0, 0, 128, 128).data;
  });
}

/**
 * Encodes the frames as a looping GIF. Quantising each frame separately would
 * make the palette shimmer between frames, so one palette is built from the
 * first frame and reused; these emojis are a handful of flat colours, so that
 * costs nothing visually.
 */
export function renderAnimatedEmoji(name: InochiEmoji, frames = FRAMES) {
  const gif = GIFEncoder();
  const rendered = renderEmojiFrames(name, frames);
  const palette = quantize(rendered[0]!, 64, { format: "rgba4444" });
  for (const frame of rendered) {
    gif.writeFrame(applyPalette(frame, palette, "rgba4444"), 128, 128, {
      palette,
      delay: FRAME_DELAY_MS,
      transparent: true,
      solid: false,
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** PNG for a still emoji, GIF for one that earns the motion. */
export function renderEmojiAsset(name: InochiEmoji) {
  return isAnimated(name)
    ? { buffer: renderAnimatedEmoji(name), mime: "image/gif" as const }
    : { buffer: renderEmoji(name), mime: "image/png" as const };
}
