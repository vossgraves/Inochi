import "dotenv/config";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { db, eq, getOrCreateGuild, guilds, sql } from "@inochi/database";
import { handleInteraction } from "./commands/handler";
import { handleMessageXp } from "./xp";
import { captureImportMessage } from "./imports";
import { scheduleGames } from "./games";
import { scheduleDailyTopRoles } from "./daily";
import { scheduleBackups } from "./backups";
import { loadApplicationEmojis } from "./emojis";
import { registerWelcomeEvents } from "./welcome";
import { scheduleAuditDelivery } from "./logging";

if (!process.env.DISCORD_TOKEN || !process.env.DATABASE_URL || !process.env.APP_URL) {
  throw new Error("DISCORD_TOKEN, DATABASE_URL, and APP_URL are required");
}

await db.execute(sql`select 1`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
  partials: [Partials.Channel, Partials.Message],
  allowedMentions: { parse: ["users"] },
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Inochi online as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} servers.`);
  if (readyClient.user.username !== "Inochi") void readyClient.user.setUsername("Inochi").catch((error) => console.warn("Could not update the Discord username to Inochi:", error));
  scheduleGames(readyClient);
  scheduleDailyTopRoles(readyClient);
  scheduleBackups(readyClient);
  await loadApplicationEmojis(readyClient);
  scheduleAuditDelivery(readyClient);
  for (const guild of readyClient.guilds.cache.values()) {
    await getOrCreateGuild(db, guild.id, guild.name);
    await db.update(guilds).set({ joinedAt: new Date(), leftAt: null }).where(eq(guilds.id, guild.id));
  }
});
registerWelcomeEvents(client);
client.on("interactionCreate", handleInteraction);
client.on("messageCreate", async (message) => {
  if (message.author.bot) await captureImportMessage(message);
  else await handleMessageXp(message);
});
client.on("messageUpdate", async (_, message) => {
  const fetched = message.partial ? await message.fetch().catch(() => null) : message;
  if (fetched?.author.bot) await captureImportMessage(fetched);
});
client.on("guildMemberAdd", async (member) => {
  const { db, getOrCreateGuild } = await import("@inochi/database");
  const guild = await getOrCreateGuild(db, member.guild.id, member.guild.name);
  if (guild.settings.community.joinRoleId) await member.roles.add(guild.settings.community.joinRoleId, "Inochi join role").catch(() => undefined);
});
client.on("guildMemberRemove", async (member) => {
  const { and, db, eq, getOrCreateGuild, members } = await import("@inochi/database");
  const guild = await getOrCreateGuild(db, member.guild.id, member.guild.name);
  if (guild.settings.community.clearOnLeave) await db.delete(members).where(and(eq(members.guildId, member.guild.id), eq(members.userId, member.id)));
});
client.on("error", console.error);

await client.login(process.env.DISCORD_TOKEN);
