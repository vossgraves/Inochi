import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, PermissionFlagsBits, type Client, type Guild, type TextChannel } from "discord.js";
import { and, db, eq, getOrCreateGuild, guilds, isNull } from "@inochi/database";
import { icon } from "./emojis";
import { INOCHI_NAVY } from "./theme";

function writable(guild: Guild, channel: TextChannel | null | undefined) {
  const permissions = channel?.permissionsFor(guild.members.me!);
  return channel && !channel.nsfw && permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
}

async function welcome(guild: Guild) {
  const row = await getOrCreateGuild(db, guild.id, guild.name);
  if (row.welcomeSentAt && !row.leftAt) return;
  const [claimed] = await db.update(guilds).set({ joinedAt: new Date(), leftAt: null, welcomeSentAt: new Date() }).where(and(eq(guilds.id, guild.id), isNull(guilds.welcomeSentAt))).returning({ id: guilds.id });
  if (!claimed) return;
  const named = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText && ["setup", "bot-commands", "bots"].includes(channel.name.toLowerCase())).first() as TextChannel | undefined;
  const destination = writable(guild, guild.systemChannel) ? guild.systemChannel : writable(guild, named) ? named : null;
  const setupUrl = `${process.env.APP_URL!.replace(/\/$/, "")}/dashboard/${guild.id}/setup`;
  const embed = new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(`${icon(guild.client, "levelup")} Inochi is ready`).setDescription("XP starts paused so nothing changes before you choose how progression should work. The guided setup covers channels, leveling speed, logs, backups, and a final permission check.").addFields({ name: "Start", value: "Open the setup wizard below, or run `/setup` later." }, { name: "Verify", value: "Run `/diagnose` after setup to check permissions and references." });
  const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(setupUrl).setLabel("Open setup wizard"))];
  let sent;
  let channelId: string | null = null;
  if (destination) {
    sent = await destination.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    channelId = destination.id;
  }
  if (!sent) {
    const owner = await guild.fetchOwner().catch(() => null);
    sent = await owner?.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    channelId = null;
  }
  if (sent) await db.update(guilds).set({ welcomeSentAt: new Date(), welcomeChannelId: channelId, welcomeMessageId: sent.id }).where(eq(guilds.id, guild.id));
  else await db.update(guilds).set({ welcomeSentAt: null }).where(eq(guilds.id, guild.id));
}

export function registerWelcomeEvents(client: Client) {
  client.on(Events.GuildCreate, (guild) => void welcome(guild).catch(console.error));
  client.on(Events.GuildDelete, (guild) => void db.update(guilds).set({ leftAt: new Date(), welcomeSentAt: null, welcomeChannelId: null, welcomeMessageId: null }).where(eq(guilds.id, guild.id)).catch(console.error));
}
