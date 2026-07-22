import type { Client } from "discord.js";

export const emojiFallbacks = {
  success: "✓", warning: "!", error: "✕", info: "i", settings: "⚙", xp: "+XP",
  levelup: "↑", rank: "#", leaderboard: "≡", games: ">", security: "◆", backup: "↻",
} as const;

export type InochiEmoji = keyof typeof emojiFallbacks;

export async function loadApplicationEmojis(client: Client<true>) {
  await client.application.emojis.fetch().catch((error) => console.warn("Could not load application emojis:", error));
}

export function icon(client: Client, name: InochiEmoji) {
  return client.application?.emojis.cache.find((emoji) => emoji.name === `inochi_${name}`)?.toString() ?? emojiFallbacks[name];
}
