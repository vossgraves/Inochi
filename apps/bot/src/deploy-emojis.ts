import "dotenv/config";
import { createCanvas } from "@napi-rs/canvas";
import "@inochi/rank-card";
import { REST, Routes } from "discord.js";
import { emojiFallbacks } from "./emojis";

const token = process.env.DISCORD_TOKEN;
const applicationId = process.env.DISCORD_CLIENT_ID;
if (!token || !applicationId) throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
const rest = new REST({ version: "10" }).setToken(token);
const current = await rest.get(Routes.applicationEmojis(applicationId)) as { items: { id: string; name: string }[] };
const marks: Record<keyof typeof emojiFallbacks, string> = { success: "OK", warning: "!", error: "X", info: "i", settings: "CFG", xp: "XP", levelup: "UP", rank: "#", leaderboard: "TOP", games: "GO", security: "SAFE", backup: "BAK", coinflip: "CF" };

for (const name of Object.keys(emojiFallbacks) as (keyof typeof emojiFallbacks)[]) {
  const mark = marks[name];
  const emojiName = `inochi_${name}`;
  if (current.items.some((emoji) => emoji.name === emojiName)) continue;
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#151922";
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 28);
  ctx.fill();
  ctx.strokeStyle = "#8ba8ff";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = "#f4f6fa";
  ctx.font = `${mark.length > 2 ? 700 : 800} ${mark.length > 2 ? 38 : 62}px 'Inochi Sans'`;
  ctx.textAlign = "center";
  ctx.fillText(mark, 64, 84);
  await rest.post(Routes.applicationEmojis(applicationId), { body: { name: emojiName, image: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}` } });
  console.log(`Created application emoji ${emojiName}`);
}
