import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { handleInteraction } from "./commands/handler";
import { handleMessageXp } from "./xp";
import { captureImportMessage } from "./imports";
import { scheduleGames } from "./games";

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is required");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
  partials: [Partials.Channel, Partials.Message],
  allowedMentions: { parse: ["users"] },
});

client.once("ready", (readyClient) => {
  console.log(`Inochi online as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} servers.`);
  if (readyClient.user.username !== "Inochi") void readyClient.user.setUsername("Inochi").catch((error) => console.warn("Could not update the Discord username to Inochi:", error));
  scheduleGames(readyClient);
});
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
