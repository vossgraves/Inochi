import { notice } from "./replies";
import { createHash } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { levelForXp, xpForLevel, type GuildSettings } from "@inochi/core";
import {
  claimDuePersistentLeaderboards,
  completeDisabledPersistentLeaderboard,
  completePersistentLeaderboard,
  configurePersistentLeaderboard,
  db,
  failPersistentLeaderboard,
  getLeaderboard,
  getOrCreateGuild,
  getPersistentLeaderboardStatus,
  inArray,
  rankProfiles,
  updatePersistentLeaderboardMessage,
  type PersistentLeaderboardClaim,
} from "@inochi/database";
import { ButtonStyle, DiscordAPIError, MessageFlags, type ButtonInteraction, type Client, type Guild, type MessageCreateOptions } from "discord.js";
import { INOCHI_VERMILION } from "./theme";

export interface LeaderboardRenderOptions {
  rows?: number;
  page?: number;
  highlightedUserId?: string;
  interactiveUserId?: string;
  updatedAt?: Date;
}

export async function renderLeaderboard(guild: Guild, settings: GuildSettings, options: LeaderboardRenderOptions = {}) {
  const limit = Math.max(1, Math.min(options.rows ?? 10, 25));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const offset = (page - 1) * limit;
  const rows = await getLeaderboard(db, guild.id, limit, offset, {
    minimumXp: xpForLevel(settings.leaderboard.minLevel, settings),
    maximumEntries: settings.leaderboard.maxEntries,
  });
  const privateIds = rows.length ? new Set((await db.select({ userId: rankProfiles.userId, leaderboardPrivate: rankProfiles.leaderboardPrivate }).from(rankProfiles)
    .where(inArray(rankProfiles.userId, rows.map((row) => row.userId)))).filter((profile) => profile.leaderboardPrivate).map((profile) => profile.userId)) : new Set<string>();
  const body = rows.map((row, index) => {
    const marker = row.userId === options.highlightedUserId ? " **you**" : "";
    const member = privateIds.has(row.userId) ? "Private member" : `<@${row.userId}>`;
    return `\`${String(offset + index + 1).padStart(2, "0")}\` ${member} · **Lv. ${levelForXp(row.xp, settings)}** · ${row.xp.toLocaleString()} XP${marker}`;
  }).join("\n") || "No ranked members yet.";
  const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/leaderboard/${guild.id}`;
  const buttons = new ActionRowBuilder<ButtonBuilder>();
  if (options.interactiveUserId) buttons.addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId(`leaderboard:${options.interactiveUserId}:${page - 1}`).setLabel("Previous").setDisabled(page <= 1),
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId(`leaderboard:${options.interactiveUserId}:${page + 1}`).setLabel("Next").setDisabled(rows.length < limit),
  );
  buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Open web leaderboard"));
  const updated = options.updatedAt
    ? `\n### Updated <t:${Math.floor(options.updatedAt.getTime() / 1000)}:R>`
    : "";
  const container = new ContainerBuilder().setAccentColor(INOCHI_VERMILION)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${guild.name} leaderboard${page > 1 ? ` · page ${page}` : ""}\n${body}${updated}`))
    .addActionRowComponents(buttons);
  const payload = { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } } satisfies MessageCreateOptions;
  const contentHash = createHash("sha256").update(JSON.stringify(container.toJSON())).digest("hex");
  return { payload, contentHash, rows };
}

export async function handleLeaderboardComponent(interaction: ButtonInteraction) {
  if (!interaction.customId.startsWith("leaderboard:")) return false;
  const [, ownerId, rawPage] = interaction.customId.split(":");
  if (ownerId !== interaction.user.id) throw notice("Only the member who opened this leaderboard can change pages");
  if (!interaction.guild || !rawPage) throw notice("This leaderboard is no longer available");
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) throw notice("That leaderboard page is no longer available.", "Run /top again for a fresh board.");
  const guildRow = await getOrCreateGuild(db, interaction.guild.id, interaction.guild.name);
  if (!guildRow.settings.enabled || !guildRow.settings.leaderboard.enabled) throw notice("The leaderboard is turned off in this server.", "A manager can enable it from the dashboard.");
  const rendered = await renderLeaderboard(interaction.guild, guildRow.settings, { page, interactiveUserId: ownerId });
  await interaction.update(rendered.payload);
  return true;
}

export async function persistentLeaderboardPayload(guild: Guild, settings: GuildSettings) {
  return renderLeaderboard(guild, settings, {
    rows: settings.leaderboard.persistent.rows,
    updatedAt: new Date(),
  });
}

export async function sendOrUpdatePersistentLeaderboard(client: Client, guild: Guild, settings: GuildSettings) {
  const intent = settings.leaderboard.persistent;
  if (!settings.leaderboard.enabled || !intent.enabled || !intent.channelId) throw notice("The persistent leaderboard is not enabled");
  const channel = await client.channels.fetch(intent.channelId);
  if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel) || !("messages" in channel) || !("guildId" in channel) || channel.guildId !== guild.id) {
    throw notice("Persistent leaderboard channel is not writable in this server");
  }
  const rendered = await persistentLeaderboardPayload(guild, settings);
  const status = await getPersistentLeaderboardStatus(db, guild.id);
  let message = status?.messageId ? await channel.messages.fetch(status.messageId).catch((error) => {
    if (error instanceof DiscordAPIError && error.code === 10008) return null;
    throw error;
  }) : null;
  if (!message) message = await channel.send(rendered.payload);
  else message = await message.edit(rendered.payload);
  await updatePersistentLeaderboardMessage(db, guild.id, { channelId: channel.id, messageId: message.id, contentHash: rendered.contentHash });
  return message;
}

async function renderClaim(client: Client, claim: PersistentLeaderboardClaim) {
  const guild = client.guilds.cache.get(claim.guildId) ?? await client.guilds.fetch(claim.guildId);
  const guildRow = await getOrCreateGuild(db, guild.id, guild.name);
  const intent = guildRow.settings.leaderboard.persistent;
  if (!claim.enabled) {
    if (claim.messageId) {
      const oldChannel = await client.channels.fetch(claim.channelId).catch(() => null);
      if (oldChannel?.isTextBased() && !oldChannel.isDMBased() && "messages" in oldChannel) {
        await oldChannel.messages.delete(claim.messageId).catch((error) => {
          if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
        });
      }
    }
    await completeDisabledPersistentLeaderboard(db, claim);
    if (guildRow.settings.leaderboard.enabled && intent.enabled && intent.channelId) {
      await configurePersistentLeaderboard(db, { guildId: guild.id, channelId: intent.channelId });
    }
    return;
  }
  if (!guildRow.settings.leaderboard.enabled || !intent.enabled || !intent.channelId || intent.channelId !== claim.channelId) {
    throw notice("Persistent leaderboard intent no longer matches its stored configuration");
  }
  const channel = await client.channels.fetch(claim.channelId);
  if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel) || !("messages" in channel) || !("guildId" in channel) || channel.guildId !== claim.guildId) throw notice("Persistent leaderboard channel is not writable in this server");
  const rendered = await persistentLeaderboardPayload(guild, guildRow.settings);
  let message = claim.messageId ? await channel.messages.fetch(claim.messageId).catch((error) => {
    if (error instanceof DiscordAPIError && error.code === 10008) return null;
    throw error;
  }) : null;
  if (!message) message = await channel.send(rendered.payload);
  else if (claim.contentHash !== rendered.contentHash) message = await message.edit(rendered.payload);
  await completePersistentLeaderboard(db, claim, { channelId: channel.id, messageId: message.id, contentHash: rendered.contentHash });
}

export async function runPersistentLeaderboardScheduler(client: Client) {
  const claims = await claimDuePersistentLeaderboards(db);
  await Promise.all(claims.map(async (claim) => {
    try {
      await renderClaim(client, claim);
    } catch (error) {
      await failPersistentLeaderboard(db, claim, error);
    }
  }));
  return claims.length;
}

export function schedulePersistentLeaderboards(client: Client) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runPersistentLeaderboardScheduler(client);
    } finally {
      running = false;
    }
  };
  void run().catch(console.error);
  const timer = setInterval(() => void run().catch(console.error), 600_000);
  timer.unref();
  return () => clearInterval(timer);
}
