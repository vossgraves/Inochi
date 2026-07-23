import "dotenv/config";
import { Client, Events, GatewayIntentBits, Options, Partials } from "discord.js";
import { db, eq, expireImports, getOrCreateGuild, guilds, sql } from "@inochi/database";
import { handleInteraction } from "./commands/handler";
import { handleMessageXp } from "./xp";
import { captureImportMessage } from "./imports";
import { scheduleGames } from "./games";
import { scheduleDailyTopRoles } from "./daily";
import { scheduleBackups } from "./backups";
import { loadApplicationEmojis } from "./emojis";
import { registerWelcomeEvents } from "./welcome";
import { scheduleAuditDelivery } from "./logging";
import { expireCoinflips } from "./coinflip";

if (!process.env.DISCORD_TOKEN || !process.env.DATABASE_URL || !process.env.APP_URL) {
  throw new Error("DISCORD_TOKEN, DATABASE_URL, and APP_URL are required");
}

await db.execute(sql`select 1`);

const client = new Client({
  shards: "auto",
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel, Partials.Message],
  allowedMentions: { parse: ["users"] },
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    ReactionManager: 0,
    ThreadMemberManager: 0,
    UserManager: 5_000,
    GuildMemberManager: { maxSize: 1_000, keepOverLimit: (member) => member.id === member.guild.members.me?.id },
  }),
  sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 60 } },
});

client.once(Events.ClientReady, (readyClient) => void (async () => {
  console.log(`Inochi online as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} servers.`);
  if (readyClient.user.username !== "Inochi") void readyClient.user.setUsername("Inochi").catch((error) => console.warn("Could not update the Discord username to Inochi:", error));
  scheduleGames(readyClient);
  const expireChallenges = () => void expireCoinflips(readyClient).catch((error) => console.error("coinflip_expiry_failed", { error }));
  expireChallenges();
  setInterval(expireChallenges, 30_000).unref();
  const expireImportSessions = () => void expireImports(db).catch((error) => console.error("import_expiry_failed", { error }));
  expireImportSessions();
  setInterval(expireImportSessions, 60_000).unref();
  scheduleDailyTopRoles(readyClient);
  scheduleBackups(readyClient);
  await loadApplicationEmojis(readyClient);
  scheduleAuditDelivery(readyClient);
  for (const guild of readyClient.guilds.cache.values()) {
    await getOrCreateGuild(db, guild.id, guild.name);
    await db.update(guilds).set({ joinedAt: new Date(), leftAt: null }).where(eq(guilds.id, guild.id));
  }
})().catch((error) => console.error("ready_listener_failure", { error })));
registerWelcomeEvents(client);
client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction).catch((error) => console.error("interaction_listener_failure", { interactionId: interaction.id, error }));
});
client.on("messageCreate", (message) => void (async () => {
  if (message.author.bot) await captureImportMessage(message);
  else await handleMessageXp(message);
})().catch((error) => console.error("message_create_failure", { guildId: message.guildId, channelId: message.channelId, messageId: message.id, error })));
client.on("messageUpdate", (_, message) => void (async () => {
  const fetched = message.partial ? await message.fetch().catch(() => null) : message;
  if (fetched?.author.bot) await captureImportMessage(fetched);
})().catch((error) => console.error("message_update_failure", { guildId: message.guildId, channelId: message.channelId, messageId: message.id, error })));
client.on("guildMemberAdd", (member) => void (async () => {
  const { db, getOrCreateGuild } = await import("@inochi/database");
  const guild = await getOrCreateGuild(db, member.guild.id, member.guild.name);
  if (guild.settings.community.joinRoleId) await member.roles.add(guild.settings.community.joinRoleId, "Inochi join role").catch(() => undefined);
})().catch((error) => console.error("guild_member_add_failure", { guildId: member.guild.id, userId: member.id, error })));
client.on("guildMemberRemove", (member) => void (async () => {
  const { and, db, eq, getOrCreateGuild, members } = await import("@inochi/database");
  const guild = await getOrCreateGuild(db, member.guild.id, member.guild.name);
  if (guild.settings.community.clearOnLeave) await db.delete(members).where(and(eq(members.guildId, member.guild.id), eq(members.userId, member.id)));
})().catch((error) => console.error("guild_member_remove_failure", { guildId: member.guild.id, userId: member.id, error })));
client.on("error", console.error);

await client.login(process.env.DISCORD_TOKEN);
