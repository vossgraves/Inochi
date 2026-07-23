import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  type Interaction,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { levelForXp, parseGuildSettings, progressForXp, xpForLevel } from "@inochi/core";
import {
  auditLogs,
  db,
  configurePersistentLeaderboard,
  disablePersistentLeaderboard,
  getPersistentLeaderboardStatus,
  getOrCreateGuild,
  getRank,
  members,
  guilds,
  and,
  eq,
  sql,
  desc,
  activeVote,
  rankProfiles,
  xpPeriods,
  markPersistentLeaderboardDirty,
  markPersistentLeaderboardsForUserDirty,
  retryPersistentLeaderboard,
} from "@inochi/database";
import { renderRankCard } from "@inochi/rank-card";
import { startGame } from "../games";
import { backgroundUrl, deleteBackground, uploadBackground } from "../storage";
import { recordAudit, sendGuildLog } from "../logging";
import { handleImportComponent, showImportPanel } from "../imports";
import { handleCoinflipComponent, startCoinflip } from "../coinflip";
import { INOCHI_NAVY, WARNING_AMBER } from "../theme";
import { commandDetailComponents, commandOverviewComponents } from "./help";
import { handleLeaderboardComponent, renderLeaderboard } from "../leaderboard";

async function settingsFor(interaction: Interaction) {
  if (!interaction.guild) throw new Error("This command only works in a server");
  return getOrCreateGuild(db, interaction.guild.id, interaction.guild.name);
}

async function replyError(interaction: Interaction, error: unknown) {
  if (!interaction.isRepliable()) return;
  const known = error instanceof Error && error.constructor === Error && !("code" in error) && !("cause" in error);
  const reference = randomUUID().slice(0, 8).toUpperCase();
  const content = known ? `**Error:** ${error.message}` : `Something went wrong. Reference \`${reference}\`.`;
  if (!known) console.error("interaction_failure", { reference, interactionId: interaction.id, type: interaction.type, guildId: interaction.guildId, userId: interaction.user.id, error });
  try {
    if (interaction.replied || ((interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) && interaction.deferred)) await interaction.followUp({ content, ephemeral: true });
    else if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [], files: [] });
    else await interaction.reply({ content, ephemeral: true });
  } catch (replyFailure) {
    console.error("interaction_error_response_failure", { reference, interactionId: interaction.id, replyFailure });
  }
}

type RankInteraction = ChatInputCommandInteraction | UserContextMenuCommandInteraction;

async function showRank(interaction: RankInteraction, forcedUserId?: string) {
  const guild = await settingsFor(interaction);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  if (!guild.settings.rankCard.enabled) throw new Error("Rank cards are disabled in this server");
  const user = forcedUserId ? await interaction.client.users.fetch(forcedUserId) : interaction.isChatInputCommand() ? interaction.options.getUser("member") ?? interaction.user : interaction.user;
  await interaction.deferReply({ ephemeral: guild.settings.rankCard.ephemeral || (interaction.isChatInputCommand() && interaction.options.getBoolean("hidden") === true) });
  const rank = await getRank(db, interaction.guildId!, user.id);
  if (!rank || rank.xp <= 0) throw new Error(`${user.displayName} has not earned XP yet`);
  const progress = progressForXp(rank.xp, guild.settings);
  if (interaction.isChatInputCommand() && interaction.options.getBoolean("text_mode") === true) {
    await interaction.editReply(`**${user.displayName}** · Rank **#${rank.rank}** · Level **${progress.level}** · **${rank.xp.toLocaleString()} XP** · ${Math.round(progress.progress * 100)}% to the next level`);
    return;
  }
  const profile = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, user.id) });
  const image = await renderRankCard({
    username: user.displayName,
    avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
    rank: rank.rank,
    level: progress.level,
    xp: rank.xp,
    currentLevelXp: guild.settings.rankCard.relativeXp ? progress.current : 0,
    nextLevelXp: progress.next,
    progress: progress.progress,
    accentColor: profile?.colorMode === "custom" && profile.color ? profile.color : guild.settings.rankCard.accentColor,
    backgroundUrl: backgroundUrl(profile?.backgroundKey ?? guild.settings.rankCard.backgroundKey),
    backgroundOverlay: guild.settings.rankCard.backgroundOverlay,
    avatarShape: guild.settings.rankCard.avatarShape,
    surface: guild.settings.rankCard.surface,
    progressStyle: guild.settings.rankCard.progressStyle,
  });
  await interaction.editReply({ files: [new AttachmentBuilder(image, { name: "rank.png" })] });
}

async function showTop(interaction: RankInteraction, forcedUserId?: string) {
  const guild = await settingsFor(interaction);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  if (!guild.settings.leaderboard.enabled) throw new Error("The leaderboard is disabled");
  const page = interaction.isChatInputCommand() ? interaction.options.getInteger("page") ?? 1 : 1;
  const targetId = forcedUserId ?? (interaction.isChatInputCommand() ? interaction.options.getUser("member")?.id : undefined);
  const rendered = await renderLeaderboard(interaction.guild!, guild.settings, { page, highlightedUserId: targetId, interactiveUserId: interaction.user.id });
  await interaction.reply(rendered.payload);
}

function expectedRewardRoles(member: GuildMember, level: number, rewards: Array<{ roleId: string; level: number; keep: boolean; noSync: boolean }>) {
  const reached = rewards.filter((reward) => reward.level <= level && !reward.noSync);
  const highest = Math.max(0, ...reached.map((reward) => reward.level));
  const expected = reached.filter((reward) => reward.keep || reward.level === highest).map((reward) => reward.roleId);
  const configured = rewards.filter((reward) => !reward.noSync).map((reward) => reward.roleId);
  return {
    add: expected.filter((id) => !member.roles.cache.has(id)),
    remove: configured.filter((id) => member.roles.cache.has(id) && !expected.includes(id)),
  };
}

async function syncMember(member: GuildMember) {
  const guild = await getOrCreateGuild(db, member.guild.id, member.guild.name);
  const rank = await getRank(db, member.guild.id, member.id);
  const excluded = guild.settings.community.noRewardRoleIds.some((roleId) => member.roles.cache.has(roleId));
  const changes = expectedRewardRoles(member, excluded ? 0 : levelForXp(rank?.xp ?? 0, guild.settings), guild.settings.rewards);
  if (changes.add.length) await member.roles.add(changes.add, "Inochi level rewards");
  if (changes.remove.length) await member.roles.remove(changes.remove, "Inochi level rewards");
  return changes;
}

async function updateSettings(interaction: ChatInputCommandInteraction, updater: (settings: Awaited<ReturnType<typeof settingsFor>>["settings"]) => void, action: string) {
  const guild = await settingsFor(interaction);
  updater(guild.settings);
  const settings = parseGuildSettings(guild.settings);
  await db.update(guilds).set({ settings, updatedAt: new Date() }).where(eq(guilds.id, interaction.guildId!));
  await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action });
  return settings;
}

export async function handleInteraction(interaction: Interaction) {
  try {
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) await interaction.reply({ content: "This action only works in a server.", ephemeral: true });
      return;
    }
    if (interaction.isButton()) {
      if (await handleImportComponent(interaction)) return;
      if (await handleCoinflipComponent(interaction)) return;
      if (await handleLeaderboardComponent(interaction)) return;
      await interaction.reply({ content: "This control is no longer available.", ephemeral: true });
      return;
    }
    if (interaction.isAnySelectMenu()) {
      if (await handleImportComponent(interaction)) return;
      await interaction.reply({ content: "This menu is no longer available.", ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit()) {
      await interaction.reply({ content: "This interaction is no longer available.", ephemeral: true });
      return;
    }
    if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand()) return;
    if (interaction.isUserContextMenuCommand()) {
      void sendGuildLog(interaction.client, interaction.guildId!, "commandUsage", "Context command used", `<@${interaction.user.id}> used \`${interaction.commandName}\` in <#${interaction.channelId}>.`).catch(console.error);
      if (interaction.commandName === "Check XP") return showRank(interaction, interaction.targetId);
      if (interaction.commandName === "View on leaderboard") return showTop(interaction, interaction.targetId);
      return;
    }
    const command = interaction.commandName;
    const managerCommands = new Set(["winner", "joinrole", "blacklist", "reset", "refresh", "addxp", "clear", "config", "rewardrole", "multiplier", "word", "maths", "xpchannel", "diagnose", "import", "setup", "leaderboard"]);
    if (managerCommands.has(command) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Manage Server permission is required");
    void sendGuildLog(interaction.client, interaction.guildId!, "commandUsage", "Command used", `<@${interaction.user.id}> used \`/${command}\` in <#${interaction.channelId}>.`).catch(console.error);
    if (managerCommands.has(command)) void recordAudit(interaction.guildId!, interaction.user.id, "command.admin", { command, channelId: interaction.channelId }).catch(console.error);
    if (command === "rank") return showRank(interaction);
    if (command === "top") return showTop(interaction);
    if (command === "help") {
      const guild = await settingsFor(interaction);
      const requested = interaction.options.getString("command");
      const payload = requested ? commandDetailComponents(requested, guild.settings.commands.prefix) : commandOverviewComponents(guild.settings.commands.prefix);
      if (!payload) throw new Error(`Unknown command: ${requested}`);
      return interaction.reply(payload);
    }
    if (command === "leaderboard") {
      const guild = await settingsFor(interaction);
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "status") {
        const status = await getPersistentLeaderboardStatus(db, interaction.guildId!);
        if (!status) return interaction.reply({ content: "Persistent leaderboard is not configured.", ephemeral: true });
        return interaction.reply({ content: `Channel: <#${status.channelId}>\nMessage: ${status.messageId ? `[open message](https://discord.com/channels/${interaction.guildId}/${status.channelId}/${status.messageId})` : "pending"}\nState: **${status.enabled ? status.dirty ? "waiting for refresh" : "active" : "disabling"}**${status.lastError ? `\nLast error: ${status.lastError}` : ""}`, ephemeral: true });
      }
      if (subcommand === "refresh") {
        const status = await retryPersistentLeaderboard(db, interaction.guildId!);
        if (!status) throw new Error("Configure the persistent leaderboard first");
        return interaction.reply({ content: "Persistent leaderboard refresh queued.", ephemeral: true });
      }
      if (subcommand === "disable") {
        await updateSettings(interaction, (settings) => { settings.leaderboard.persistent.enabled = false; }, "settings.persistent-leaderboard");
        await disablePersistentLeaderboard(db, interaction.guildId!);
        return interaction.reply({ content: "Persistent leaderboard disabled. Its message will be removed shortly.", ephemeral: true });
      }
      const channel = interaction.options.getChannel("channel", true);
      if (!("guildId" in channel) || channel.guildId !== interaction.guildId || !channel.isTextBased()) throw new Error("Choose a text channel in this server");
      const rows = interaction.options.getInteger("rows") ?? guild.settings.leaderboard.persistent.rows;
      await updateSettings(interaction, (settings) => {
        settings.leaderboard.enabled = true;
        settings.leaderboard.persistent = { enabled: true, channelId: channel.id, rows };
      }, "settings.persistent-leaderboard");
      await configurePersistentLeaderboard(db, { guildId: interaction.guildId!, channelId: channel.id });
      return interaction.reply({ content: `Persistent leaderboard queued for ${channel} with **${rows}** rows.`, ephemeral: true });
    }
    if (command === "diagnose") {
      const guild = await settingsFor(interaction);
      const me = interaction.guild!.members.me;
      const logChannel = guild.settings.logging.channelId ? interaction.guild!.channels.cache.get(guild.settings.logging.channelId) : null;
      const logPermissions = me && logChannel?.isTextBased() ? logChannel.permissionsFor(me) : null;
      const missingRewards = guild.settings.rewards.filter((reward) => !interaction.guild!.roles.cache.has(reward.roleId)).length;
      const unmanageableRewards = me ? guild.settings.rewards.filter((reward) => { const role = interaction.guild!.roles.cache.get(reward.roleId); return role && role.position >= me.roles.highest.position; }).length : guild.settings.rewards.length;
      const missingChannels = guild.settings.channelPolicy.channelIds.filter((id) => !interaction.guild!.channels.cache.has(id)).length;
      const checks = [
        ["XP system", guild.settings.enabled], ["View channels", me?.permissions.has(PermissionFlagsBits.ViewChannel) ?? false], ["Send messages", me?.permissions.has(PermissionFlagsBits.SendMessages) ?? false],
        ["Embed links", me?.permissions.has(PermissionFlagsBits.EmbedLinks) ?? false], ["Attach files", me?.permissions.has(PermissionFlagsBits.AttachFiles) ?? false], ["Manage roles", me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false],
        ["Reward references", missingRewards === 0], ["Reward hierarchy", unmanageableRewards === 0], ["Channel references", missingChannels === 0],
        ["Audit channel", !guild.settings.logging.channelId || Boolean(logPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]))],
      ] as const;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(checks.every(([, ok]) => ok) ? INOCHI_NAVY : WARNING_AMBER).setTitle("Inochi diagnostics").setDescription(checks.map(([name, ok]) => `${ok ? "✓" : "✕"} ${name}`).join("\n")).setFooter({ text: `${missingRewards} missing roles · ${unmanageableRewards} unmanageable roles · ${missingChannels} missing channels` })], ephemeral: true });
    }
    if (command === "privacy") {
      const value = interaction.options.getBoolean("leaderboard");
      const existing = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, interaction.user.id) });
      if (value === null) return interaction.reply({ content: `Public leaderboard privacy is **${existing?.leaderboardPrivate ? "enabled" : "disabled"}**.`, ephemeral: true });
      await db.insert(rankProfiles).values({ userId: interaction.user.id, leaderboardPrivate: value }).onConflictDoUpdate({ target: rankProfiles.userId, set: { leaderboardPrivate: value, updatedAt: new Date() } });
      await markPersistentLeaderboardsForUserDirty(db, interaction.user.id);
      return interaction.reply({ content: `Your identity will ${value ? "be anonymized" : "remain visible"} on public leaderboards.`, ephemeral: true });
    }
    if (command === "colour") {
      const value = interaction.options.getString("colour");
      if (value && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Use a six-digit hex colour such as #f4f4f4");
      await db.insert(rankProfiles).values({ userId: interaction.user.id, colorMode: value ? "custom" : "monochrome", color: value })
        .onConflictDoUpdate({ target: rankProfiles.userId, set: { colorMode: value ? "custom" : "monochrome", color: value, updatedAt: new Date() } });
      return interaction.reply({ content: value ? `Rank-card colour set to **${value}**.` : "Rank-card colour reset.", ephemeral: true });
    }
    if (command === "background") {
      const subcommand = interaction.options.getSubcommand();
      const profile = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, interaction.user.id) });
      if (subcommand === "view") return interaction.reply({ content: backgroundUrl(profile?.backgroundKey) ?? "You do not have a custom background.", ephemeral: true });
      if (subcommand === "delete") {
        if (profile?.backgroundKey) await deleteBackground(profile.backgroundKey).catch(() => undefined);
        await db.insert(rankProfiles).values({ userId: interaction.user.id, backgroundKey: null }).onConflictDoUpdate({ target: rankProfiles.userId, set: { backgroundKey: null, updatedAt: new Date() } });
        return interaction.reply({ content: "Rank-card background deleted.", ephemeral: true });
      }
      const image = interaction.options.getAttachment("image", true);
      if (!image.contentType?.startsWith("image/") || image.size > 5_000_000) throw new Error("Upload an image under 5 MB");
      await interaction.deferReply({ ephemeral: true });
      const response = await fetch(image.url);
      if (!response.ok) throw new Error("Discord did not return the uploaded image");
      const key = await uploadBackground(interaction.user.id, new Uint8Array(await response.arrayBuffer()), image.contentType);
      if (profile?.backgroundKey) await deleteBackground(profile.backgroundKey).catch(() => undefined);
      await db.insert(rankProfiles).values({ userId: interaction.user.id, backgroundKey: key }).onConflictDoUpdate({ target: rankProfiles.userId, set: { backgroundKey: key, updatedAt: new Date() } });
      return interaction.editReply("Rank-card background updated.");
    }
    if (command === "wrapped") {
      const year = String(new Date().getUTCFullYear());
      const rows = await db.select().from(xpPeriods).where(and(eq(xpPeriods.guildId, interaction.guildId!), eq(xpPeriods.userId, interaction.user.id), sql`${xpPeriods.period} like ${`${year}-%`}`, sql`length(${xpPeriods.period}) = 7`)).orderBy(desc(xpPeriods.xp));
      const totalXp = rows.reduce((sum, row) => sum + row.xp, 0);
      const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0);
      const best = rows[0];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(`${year} Inochi Wrapped`).setDescription(`**${totalXp.toLocaleString()} XP** from **${totalMessages.toLocaleString()} messages** in this server.\nMost active month: **${best?.period ?? "No activity yet"}**.`)], ephemeral: true });
    }
    if (command === "vote") {
      const guild = await settingsFor(interaction);
      const vote = await activeVote(db, interaction.user.id);
      const active = vote && Date.now() - vote.votedAt.getTime() < guild.settings.multipliers.vote.durationHours * 3_600_000;
      const url = `https://top.gg/bot/${process.env.TOPGG_BOT_ID ?? process.env.DISCORD_CLIENT_ID}/vote`;
      return interaction.reply({ content: active
        ? `Your **${guild.settings.multipliers.vote.multiplier}x chat XP** vote boost expires <t:${Math.floor((vote!.votedAt.getTime() + guild.settings.multipliers.vote.durationHours * 3_600_000) / 1000)}:R>.\n${url}`
        : `Vote for Inochi to receive **${guild.settings.multipliers.vote.multiplier}x chat XP** for ${guild.settings.multipliers.vote.durationHours} hours.\n${url}`, ephemeral: true });
    }
    if (command === "xpchannel") {
      const subcommand = interaction.options.getSubcommand();
      const guild = await settingsFor(interaction);
      if (subcommand === "list") return interaction.reply({ content: `Mode: **${guild.settings.channelPolicy.mode}** · Threads: **${guild.settings.channelPolicy.threadsEnabled ? "enabled" : "disabled"}**\n${guild.settings.channelPolicy.channelIds.map((id) => `<#${id}>`).join(", ") || "No locations configured."}`, ephemeral: true });
      if (subcommand === "mode") {
        const mode = interaction.options.getString("value", true) as "allowlist" | "denylist";
        await updateSettings(interaction, (settings) => { settings.channelPolicy.mode = mode; }, "settings.channel-policy");
        return interaction.reply({ content: `Chat XP now uses **${mode}** mode.`, ephemeral: true });
      }
      if (subcommand === "threads") {
        const enabled = interaction.options.getBoolean("enabled", true);
        await updateSettings(interaction, (settings) => { settings.channelPolicy.threadsEnabled = enabled; }, "settings.channel-threads");
        return interaction.reply({ content: `Chat XP in eligible threads is **${enabled ? "enabled" : "disabled"}**.`, ephemeral: true });
      }
      const channel = interaction.options.getChannel("channel", true);
      await updateSettings(interaction, (settings) => {
        settings.channelPolicy.channelIds = settings.channelPolicy.channelIds.filter((id) => id !== channel.id);
        if (subcommand === "add") settings.channelPolicy.channelIds.push(channel.id);
      }, "settings.channel-policy");
      return interaction.reply({ content: `${channel} ${subcommand === "add" ? "added to" : "removed from"} the ${guild.settings.channelPolicy.mode}.`, ephemeral: true });
    }
    if (command === "word" || command === "maths") {
      if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) throw new Error("Choose a server text channel");
      const type = command === "word" ? "word" : "math";
      await interaction.deferReply({ ephemeral: true });
      await startGame(interaction.channel, type);
      return interaction.editReply(`${type === "word" ? "Word" : "Math"} race started in <#${interaction.channelId}>.`);
    }
    if (command === "weekly" || command === "winner") {
      const guild = await settingsFor(interaction);
      const action = command === "winner" ? "winner" : interaction.options.getString("action") ?? "show";
      const canManage = (interaction.member as GuildMember).permissions.has(PermissionFlagsBits.ManageGuild);
      if (["enable", "disable", "reset", "winner"].includes(action) && !canManage) throw new Error("Manage Server is required for that action");
      if (action === "enable" || action === "disable") {
        await updateSettings(interaction, (settings) => { settings.community.weeklyXp = action === "enable"; }, "settings.weekly");
        return interaction.reply({ content: `Weekly XP is now **${action}d**.`, ephemeral: true });
      }
      if (!guild.settings.community.weeklyXp) throw new Error("Weekly XP is disabled");
      const winners = await db.select().from(members).where(and(eq(members.guildId, interaction.guildId!), sql`${members.weeklyXp} > 0`)).orderBy(desc(members.weeklyXp)).limit(command === "winner" ? 3 : 10);
      if (action === "reset") {
        await db.update(members).set({ weeklyXp: 0 }).where(eq(members.guildId, interaction.guildId!));
        await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "weekly.reset" });
        return interaction.reply({ content: "Weekly XP reset.", ephemeral: true });
      }
      const body = winners.map((member, index) => `\`${index + 1}\` <@${member.userId}> · **${member.weeklyXp.toLocaleString()} XP**`).join("\n") || "No weekly XP has been earned.";
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(command === "winner" ? "Weekly winners" : "Weekly leaderboard").setDescription(body)] });
    }
    if (command === "joinrole") {
      const role = interaction.options.getRole("role");
      await updateSettings(interaction, (settings) => { settings.community.joinRoleId = role?.id ?? null; }, "settings.join-role");
      return interaction.reply({ content: role ? `<@&${role.id}> will be granted to new members.` : "Join role disabled.", ephemeral: true });
    }
    if (command === "blacklist") {
      const action = interaction.options.getString("action", true);
      const role = interaction.options.getRole("role");
      const guild = await settingsFor(interaction);
      if (action === "show") return interaction.reply({ content: guild.settings.community.blacklistRoleIds.map((id) => `<@&${id}>`).join(", ") || "No roles are blacklisted.", ephemeral: true });
      if (!role) throw new Error("Choose a role to add or remove");
      await updateSettings(interaction, (settings) => {
        settings.community.blacklistRoleIds = settings.community.blacklistRoleIds.filter((id) => id !== role.id);
        if (action === "add") settings.community.blacklistRoleIds.push(role.id);
      }, "settings.blacklist");
      return interaction.reply({ content: `${role.name} ${action === "add" ? "cannot earn XP" : "can earn XP again"}.`, ephemeral: true });
    }
    if (command === "reset") {
      const user = interaction.options.getUser("member", true);
      await db.update(members).set({ xp: 0, weeklyXp: 0, cooldownUntil: null }).where(and(eq(members.guildId, interaction.guildId!), eq(members.userId, user.id)));
      await markPersistentLeaderboardDirty(db, interaction.guildId!);
      await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "xp.reset-member", metadata: { userId: user.id } });
      return interaction.reply({ content: `Reset all XP for <@${user.id}>.`, ephemeral: true });
    }
    if (command === "refresh") {
      const scope = interaction.options.getString("scope", true);
      if (scope === "points") {
        if (interaction.options.getString("confirmation") !== "RESET") throw new Error("Type RESET in confirmation to clear every member's points");
        await db.update(members).set({ xp: 0, weeklyXp: 0, cooldownUntil: null }).where(eq(members.guildId, interaction.guildId!));
        await markPersistentLeaderboardDirty(db, interaction.guildId!);
        await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "xp.reset-all" });
        return interaction.reply({ content: "All server points were reset.", ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const guildMembers = await interaction.guild!.members.fetch();
      let changed = 0;
      for (const member of guildMembers.values()) {
        if (member.user.bot) continue;
        const result = await syncMember(member).catch(() => null);
        if (result) changed += result.add.length + result.remove.length;
      }
      return interaction.editReply(`Reward roles refreshed with ${changed} role changes.`);
    }
    if (command === "config") return interaction.reply({ content: `Configure **${interaction.guild!.name}** at ${process.env.APP_URL ?? "http://localhost:3000"}/dashboard/${interaction.guildId}`, ephemeral: true });
    if (command === "setup") {
      const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/dashboard/${interaction.guildId}/setup`;
      return interaction.reply({ content: "Use the guided setup to configure progression safely before enabling XP.", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Open setup wizard"))], ephemeral: true });
    }
    if (command === "botstatus") return interaction.reply({ embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle("Inochi status").addFields(
      { name: "Servers", value: interaction.client.guilds.cache.size.toLocaleString(), inline: true },
      { name: "Shards", value: String(interaction.client.ws.shards.size), inline: true },
      { name: "Ping", value: `${interaction.client.ws.ping} ms`, inline: true },
      { name: "Uptime", value: `${Math.floor(interaction.client.uptime / 60_000)} min`, inline: true },
    )] });
    if (command === "import") return showImportPanel(interaction);
    if (command === "coinflip") {
      const user = interaction.options.getUser("opponent", true);
      const opponent = await interaction.guild!.members.fetch(user.id);
      return startCoinflip(interaction, opponent, interaction.options.getInteger("wager", true), interaction.options.getString("side", true) as "heads" | "tails");
    }
    if (command === "calculate") {
      const guild = await settingsFor(interaction);
      const user = interaction.options.getUser("member") ?? interaction.user;
      const rank = await getRank(db, interaction.guildId!, user.id);
      const target = Math.min(interaction.options.getInteger("level", true), guild.settings.curve.maxLevel);
      const required = xpForLevel(target, guild.settings);
      const remaining = Math.max(0, required - (rank?.xp ?? 0));
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(`Level ${target} calculation`).setDescription(`<@${user.id}> needs **${remaining.toLocaleString()} XP** (${required.toLocaleString()} total).`)] });
    }
    if (command === "sync") {
      const user = interaction.options.getUser("member") ?? interaction.user;
      if (user.id !== interaction.user.id && !(interaction.member as GuildMember).permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error("Manage Server is required to sync another member");
      const member = await interaction.guild!.members.fetch(user.id);
      const changes = await syncMember(member);
      return interaction.reply({ content: `Roles synchronized. Added ${changes.add.length}, removed ${changes.remove.length}.`, ephemeral: true });
    }
    if (command === "clear") {
      const user = interaction.options.getUser("member", true);
      await db.update(members).set({ cooldownUntil: null }).where(and(eq(members.guildId, interaction.guildId!), eq(members.userId, user.id)));
      return interaction.reply({ content: `Cleared <@${user.id}>'s cooldown.`, ephemeral: true });
    }
    if (command === "addxp") {
      const guild = await settingsFor(interaction);
      const user = interaction.options.getUser("member", true);
      const amount = interaction.options.getInteger("amount", true);
      const operation = interaction.options.getString("operation") ?? "add_xp";
      const current = await getRank(db, interaction.guildId!, user.id);
      const oldXp = current?.xp ?? 0;
      const oldLevel = levelForXp(oldXp, guild.settings);
      const nextXp = operation === "set_xp" ? amount
        : operation === "set_level" ? xpForLevel(amount, guild.settings)
        : operation === "add_levels" ? xpForLevel(oldLevel + amount, guild.settings)
        : oldXp + amount;
      await db.insert(members).values({ guildId: interaction.guildId!, userId: user.id, xp: Math.max(0, nextXp) }).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp: Math.max(0, nextXp), updatedAt: new Date() } });
      if (levelForXp(oldXp, guild.settings) !== levelForXp(Math.max(0, nextXp), guild.settings)) await markPersistentLeaderboardDirty(db, interaction.guildId!);
      await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "xp.modify", metadata: { userId: user.id, operation, amount, oldXp, newXp: Math.max(0, nextXp) } });
      return interaction.reply({ content: `<@${user.id}> now has **${Math.max(0, nextXp).toLocaleString()} XP**.`, ephemeral: true });
    }
    if (command === "rewardrole") {
      const role = interaction.options.getRole("role", true);
      const level = interaction.options.getInteger("level", true);
      await updateSettings(interaction, (settings) => {
        settings.rewards = settings.rewards.filter((reward) => reward.roleId !== role.id);
        if (level > 0) settings.rewards.push({ roleId: role.id, level, keep: interaction.options.getBoolean("keep") ?? false, noSync: interaction.options.getBoolean("dont_sync") ?? false });
      }, "settings.reward-role");
      return interaction.reply({ content: level > 0 ? `<@&${role.id}> is now awarded at level ${level}.` : `Removed <@&${role.id}> from rewards.`, ephemeral: true });
    }
    if (command === "multiplier") {
      const type = interaction.options.getSubcommand() as "role" | "channel";
      const entity = type === "role" ? interaction.options.getRole("role", true) : interaction.options.getChannel("channel", true);
      const value = interaction.options.getNumber("value", true);
      await updateSettings(interaction, (settings) => {
        if (type === "role") {
          settings.multipliers.roles = settings.multipliers.roles.filter((item) => item.roleId !== entity.id);
          if (value > 0) settings.multipliers.roles.push({ roleId: entity.id, multiplier: value });
        } else {
          settings.multipliers.channels = settings.multipliers.channels.filter((item) => item.channelId !== entity.id);
          if (value > 0) settings.multipliers.channels.push({ channelId: entity.id, multiplier: value });
        }
      }, "settings.multiplier");
      return interaction.reply({ content: value > 0 ? `<${type === "role" ? "@&" : "#"}${entity.id}> now earns **${value}x XP**.` : "Multiplier removed.", ephemeral: true });
    }
  } catch (error) {
    const action = interaction.isCommand() ? interaction.commandName : interaction.isMessageComponent() || interaction.isModalSubmit() ? interaction.customId : `type:${interaction.type}`;
    if (interaction.guildId) void sendGuildLog(interaction.client, interaction.guildId, "errors", "Interaction error", `\`${action}\` failed for <@${interaction.user.id}>.`).catch(console.error);
    await replyError(interaction, error);
  }
}

export { syncMember };
