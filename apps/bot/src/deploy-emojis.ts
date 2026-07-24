import "dotenv/config";
import "@inochi/rank-card";
import { REST, Routes } from "discord.js";
import { emojiFallbacks } from "./emojis";
import { renderEmoji } from "./emoji-art";

const token = process.env.DISCORD_TOKEN;
const applicationId = process.env.DISCORD_CLIENT_ID;
if (!token || !applicationId) throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
const rest = new REST({ version: "10" }).setToken(token);
const current = await rest.get(Routes.applicationEmojis(applicationId)) as { items: { id: string; name: string }[] };
for (const name of Object.keys(emojiFallbacks) as (keyof typeof emojiFallbacks)[]) {
  const emojiName = `inochi_${name}`;
  const existing = current.items.find((emoji) => emoji.name === emojiName);
  if (existing) await rest.delete(Routes.applicationEmoji(applicationId, existing.id));
  const image = `data:image/png;base64,${renderEmoji(name).toString("base64")}`;
  await rest.post(Routes.applicationEmojis(applicationId), { body: { name: emojiName, image } });
  console.log(`${existing ? "Updated" : "Created"} application emoji ${emojiName}`);
}
