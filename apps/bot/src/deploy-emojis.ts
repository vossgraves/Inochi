import "dotenv/config";
import "@inochi/rank-card";
import { REST, Routes } from "discord.js";
import { emojiFallbacks } from "./emojis";
import { EMOJI_SIZE_LIMIT, isAnimated, renderEmojiAsset } from "./emoji-art";

const token = process.env.DISCORD_TOKEN;
const applicationId = process.env.DISCORD_CLIENT_ID;
if (!token || !applicationId) throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
const rest = new REST({ version: "10" }).setToken(token);
const current = await rest.get(Routes.applicationEmojis(applicationId)) as { items: { id: string; name: string }[] };

for (const name of Object.keys(emojiFallbacks) as (keyof typeof emojiFallbacks)[]) {
  const emojiName = `inochi_${name}`;
  const existing = current.items.find((emoji) => emoji.name === emojiName);
  const { buffer, mime } = renderEmojiAsset(name);

  /*
    Discord rejects an emoji over 256 KB, and it does so after the existing one
    has already been deleted, which would leave the set short an icon. Checking
    here fails the whole run before anything is removed.
  */
  if (buffer.byteLength > EMOJI_SIZE_LIMIT) {
    throw new Error(`${emojiName} is ${(buffer.byteLength / 1024).toFixed(1)} KB, over Discord's 256 KB emoji limit`);
  }

  if (existing) await rest.delete(Routes.applicationEmoji(applicationId, existing.id));
  const image = `data:${mime};base64,${buffer.toString("base64")}`;
  await rest.post(Routes.applicationEmojis(applicationId), { body: { name: emojiName, image } });
  console.log(
    `${existing ? "Updated" : "Created"} ${emojiName} (${isAnimated(name) ? "animated" : "static"}, ${(buffer.byteLength / 1024).toFixed(1)} KB)`,
  );
}
