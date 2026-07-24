import { writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderEmoji } from "../apps/bot/src/emoji-art";
import { emojiFallbacks } from "../apps/bot/src/emojis";

const outputs = [
  [1024, new URL("../apps/web/public/brand/inochi-bot-avatar.png", import.meta.url)],
  [512, new URL("../apps/web/public/brand/inochi-app-512.png", import.meta.url)],
  [192, new URL("../apps/web/public/brand/inochi-app-192.png", import.meta.url)],
  [180, new URL("../apps/web/app/apple-icon.png", import.meta.url)],
] as const;

async function main() {
  const image = await loadImage(new URL("../apps/web/public/brand/inochi-mark.svg", import.meta.url).pathname);
  for (const [size, destination] of outputs) {
    const canvas = createCanvas(size, size);
    canvas.getContext("2d").drawImage(image, 0, 0, size, size);
    await writeFile(destination, canvas.toBuffer("image/png"));
    console.log(`Generated ${destination.pathname} (${size}x${size})`);
  }
  const names = Object.keys(emojiFallbacks) as (keyof typeof emojiFallbacks)[];
  const sheet = createCanvas(700, 360);
  const context = sheet.getContext("2d");
  context.fillStyle = "#080a18";
  context.fillRect(0, 0, 700, 360);
  context.font = "700 18px sans-serif";
  context.textAlign = "center";
  for (const [index, name] of names.entries()) {
    const image = await loadImage(`data:image/png;base64,${renderEmoji(name).toString("base64")}`);
    const column = index % 7;
    const row = Math.floor(index / 7);
    const x = 18 + column * 98;
    const y = 18 + row * 170;
    context.drawImage(image, x, y, 92, 92);
    context.fillStyle = "#b7bfdc";
    context.fillText(name, x + 46, y + 120);
  }
  const sheetDestination = new URL("../apps/web/public/brand/inochi-emoji-sheet.png", import.meta.url);
  await writeFile(sheetDestination, sheet.toBuffer("image/png"));
  console.log(`Generated ${sheetDestination.pathname} (emoji contact sheet)`);
}

void main();
