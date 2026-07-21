import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  type Interaction,
} from "discord.js";
import { levelForXp, parseGuildSettings, progressForXp, xpForLevel } from "@inochi/core";
import {
  applyImport,
  auditLogs,
  db,
  getLeaderboard,
  getOrCreateGuild,
  getRank,
  importEntries,
  importSessions,
  members,
  guilds,
  and,
  count,
  eq,
  sql,
  desc,
  activeVote,
  findActiveGameRound,
  rankProfiles,
  xpPeriods,
} from "@inochi/database";
import { fetchMee6 } from "@inochi/importers";
import { renderRankCard } from "@inochi/rank-card";
import { startGame, startWordGame } from "../games";
import { backgroundUrl, deleteBackground, uploadBackground } from "../storage";

async function settingsFor(interaction: Interaction) {
  if (!interaction.guild) throw new Error("This command only works in a server");
  return getOrCreateGuild(db, interaction.guild.id, interaction.guild.name);
}

async function replyError(interaction: Interaction, error: unknown) {
  const content = `**Error:** ${error instanceof Error ? error.message : "Unknown error"}`;
  if (!interaction.isRepliable()) return;
  if (interaction.replied || interaction.deferred) await interaction.editReply({ content, embeds: [], files: [] });
  else await interaction.reply({ content, ephemeral: true });
}

async function showRank(interaction: ChatInputCommandInteraction, forcedUserId?: string) {
  const guild = await settingsFor(interaction);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  if (!guild.settings.rankCard.enabled) throw new Error("Rank cards are disabled in this server");
  const user = forcedUserId ? await interaction.client.users.fetch(forcedUserId) : interaction.options.getUser("member") ?? interaction.user;
  await interaction.deferReply({ ephemeral: guild.settings.rankCard.ephemeral || interaction.options.getBoolean("hidden") === true });
  const rank = await getRank(db, interaction.guildId!, user.id);
  if (!rank || rank.xp <= 0) throw new Error(`${user.displayName} has not earned XP yet`);
  const progress = progressForXp(rank.xp, guild.settings);
  if (interaction.options.getBoolean("text_mode") === true) {
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
    accentColor: profile?.color ?? undefined,
    backgroundUrl: backgroundUrl(profile?.backgroundKey),
  });
  const cooldown = rank.cooldownUntil && rank.cooldownUntil > new Date() ? `<t:${Math.floor(rank.cooldownUntil.getTime() / 1000)}:R>` : "ready";
  await interaction.editReply({ content: guild.settings.rankCard.showCooldown ? `XP cooldown: ${cooldown}` : undefined, files: [new AttachmentBuilder(image, { name: "rank.png" })] });
}

async function showTop(interaction: ChatInputCommandInteraction, forcedUserId?: string) {
  const guild = await settingsFor(interaction);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  if (!guild.settings.leaderboard.enabled) throw new Error("The leaderboard is disabled");
  const page = interaction.options.getInteger("page") ?? 1;
  const targetId = forcedUserId ?? interaction.options.getUser("member")?.id;
  const rows = await getLeaderboard(db, interaction.guildId!, 10, (page - 1) * 10, {
    minimumXp: xpForLevel(guild.settings.leaderboard.minLevel, guild.settings),
    maximumEntries: guild.settings.leaderboard.maxEntries,
  });
  const description = rows.length ? rows.map((row, index) => {
    const position = (page - 1) * 10 + index + 1;
    const marker = row.userId === targetId ? " **←**" : "";
    return `\`${String(position).padStart(2, "0")}\` <@${row.userId}> · **Lv. ${levelForXp(row.xp, guild.settings)}** · ${row.xp.toLocaleString()} XP${marker}`;
  }).join("\n") : "No ranked members on this page.";
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xf4f4f4).setAuthor({ name: `${interaction.guild!.name} / leaderboard`, iconURL: interaction.guild!.iconURL() ?? undefined }).setDescription(description).setFooter({ text: `Page ${page} · ${process.env.APP_URL ?? "http://localhost:3000"}/leaderboard/${interaction.guildId}` })],
    ephemeral: guild.settings.leaderboard.ephemeral || interaction.options.getBoolean("hidden") === true,
  });
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

async function handleImport(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const active = await db.query.importSessions.findFirst({
    where: and(eq(importSessions.guildId, interaction.guildId!), eq(importSessions.createdBy, interaction.user.id), sql`${importSessions.status} in ('collecting', 'review')`),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (subcommand === "begin") {
    if (active) throw new Error("Finish or cancel your existing import first");
    const source = interaction.options.getString("source", true) as typeof importSessions.source.enumValues[number];
    const [session] = await db.insert(importSessions).values({ guildId: interaction.guildId!, createdBy: interaction.user.id, source, channelId: interaction.channelId, expiresAt: new Date(Date.now() + 30 * 60_000) }).returning();
    await interaction.reply({ content: `Import session \`${session!.id}\` is listening in this channel for public ${source} leaderboard messages for 30 minutes. Run its leaderboard command and move through every page, then use \`/import review\`. Ephemeral messages cannot be captured.`, ephemeral: true });
    return;
  }
  if (subcommand === "mee6") {
    if (active) throw new Error("Finish or cancel your existing import first");
    await interaction.deferReply({ ephemeral: true });
    const records = await fetchMee6(interaction.guildId!);
    const [session] = await db.insert(importSessions).values({ guildId: interaction.guildId!, createdBy: interaction.user.id, source: "mee6", status: "review", expiresAt: new Date(Date.now() + 30 * 60_000) }).returning();
    if (!session) throw new Error("Could not create import session");
    for (const record of records) await db.insert(importEntries).values({ sessionId: session.id, ...record }).onConflictDoNothing();
    await interaction.editReply(`Loaded **${records.length.toLocaleString()}** MEE6 records. Use \`/import apply\` to replace matching members' XP.`);
    return;
  }
  if (!active) throw new Error("You do not have an active import");
  if (subcommand === "cancel") {
    await db.update(importSessions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(importSessions.id, active.id));
    await interaction.reply({ content: "Import cancelled.", ephemeral: true });
    return;
  }
  const [total] = await db.select({ value: count() }).from(importEntries).where(eq(importEntries.sessionId, active.id));
  if (subcommand === "review") {
    await db.update(importSessions).set({ status: "review", updatedAt: new Date() }).where(eq(importSessions.id, active.id));
    const approximate = await db.select({ value: count() }).from(importEntries).where(and(eq(importEntries.sessionId, active.id), eq(importEntries.exact, false)));
    await interaction.reply({ content: `Captured **${total?.value ?? 0}** members from ${active.source}. **${approximate[0]?.value ?? 0}** contain only a level and will use the minimum XP for that level. Run \`/import apply\` to commit or \`/import cancel\`.`, ephemeral: true });
    return;
  }
  const guild = await settingsFor(interaction);
  const approximate = await db.select().from(importEntries).where(and(eq(importEntries.sessionId, active.id), eq(importEntries.exact, false)));
  for (const entry of approximate) {
    if (entry.level !== null) await db.update(importEntries).set({ xp: xpForLevel(entry.level, guild.settings) }).where(and(eq(importEntries.sessionId, active.id), eq(importEntries.userId, entry.userId)));
  }
  const imported = await applyImport(db, active.id);
  await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "xp.import", metadata: { source: active.source, count: imported } });
  await interaction.reply({ content: `Imported **${imported.toLocaleString()}** member records from ${active.source}.`, ephemeral: true });
}

export async function handleInteraction(interaction: Interaction) {
  if (!interaction.inGuild() || (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand())) return;
  try {
    if (interaction.isUserContextMenuCommand()) {
      if (interaction.commandName === "Check XP") return showRank(interaction as unknown as ChatInputCommandInteraction, interaction.targetId);
      if (interaction.commandName === "View on leaderboard") return showTop(interaction as unknown as ChatInputCommandInteraction, interaction.targetId);
      return;
    }
    const command = interaction.commandName;
    if (command === "rank") return showRank(interaction);
    if (command === "top") return showTop(interaction);
    if (command === "help") return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xf4f4f4).setTitle("Inochi commands").setDescription([
        "**Progress** · `/rank` `/top` `/weekly` `/calculate` `/sync` `/wrapped`",
        "**Games** · `/game start` `/game status` `/guess`",
        "**Personal** · `/vote` `/privacy` `/colour` `/background`",
        "**Configuration** · `/config` `/xpchannel` `/rewardrole` `/multiplier` `/joinrole` `/blacklist`",
        "**Moderation** · `/addxp` `/clear` `/reset` `/refresh` `/winner`",
        "**Migration** · `/import begin` `/import mee6` `/import review` `/import apply` `/import cancel`",
      ].join("\n"))], ephemeral: true,
    });
    if (command === "diagnose") {
      const guild = await settingsFor(interaction);
      const me = interaction.guild!.members.me;
      const missingRewards = guild.settings.rewards.filter((reward) => !interaction.guild!.roles.cache.has(reward.roleId)).length;
      const missingChannels = guild.settings.channelPolicy.channelIds.filter((id) => !interaction.guild!.channels.cache.has(id)).length;
      const checks = [
        ["XP system", guild.settings.enabled], ["Send messages", me?.permissions.has(PermissionFlagsBits.SendMessages) ?? false],
        ["Attach files", me?.permissions.has(PermissionFlagsBits.AttachFiles) ?? false], ["Manage roles", me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false],
        ["Reward references", missingRewards === 0], ["Channel references", missingChannels === 0],
      ] as const;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(checks.every(([, ok]) => ok) ? 0xf4f4f4 : 0x888888).setTitle("Inochi diagnostics").setDescription(checks.map(([name, ok]) => `${ok ? "✓" : "✕"} ${name}`).join("\n")).setFooter({ text: `${missingRewards} missing roles · ${missingChannels} missing channels` })], ephemeral: true });
    }
    if (command === "privacy") {
      const value = interaction.options.getBoolean("leaderboard");
      const existing = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, interaction.user.id) });
      if (value === null) return interaction.reply({ content: `Public leaderboard privacy is **${existing?.leaderboardPrivate ? "enabled" : "disabled"}**.`, ephemeral: true });
      await db.insert(rankProfiles).values({ userId: interaction.user.id, leaderboardPrivate: value }).onConflictDoUpdate({ target: rankProfiles.userId, set: { leaderboardPrivate: value, updatedAt: new Date() } });
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
      const rows = await db.select().from(xpPeriods).where(and(eq(xpPeriods.userId, interaction.user.id), sql`${xpPeriods.period} like ${`${year}-%`}`, sql`length(${xpPeriods.period}) = 7`)).orderBy(desc(xpPeriods.xp));
      const totalXp = rows.reduce((sum, row) => sum + row.xp, 0);
      const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0);
      const best = rows[0];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4f4f4).setTitle(`${year} Inochi Wrapped`).setDescription(`**${totalXp.toLocaleString()} XP** from **${totalMessages.toLocaleString()} messages** across ${new Set(rows.map((row) => row.guildId)).size} servers.\nMost active month: **${best?.period ?? "No activity yet"}**.`)] });
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
    if (command === "game") {
      const subcommand = interaction.options.getSubcommand();
      if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) throw new Error("Choose a server text channel");
      if (subcommand === "status") {
        const active = await findActiveGameRound(db, interaction.guildId!, interaction.channelId);
        return interaction.reply({ content: active ? `A **${active.type}** round is active until <t:${Math.floor(active.expiresAt.getTime() / 1000)}:R>.` : "No game is active here.", ephemeral: true });
      }
      const type = interaction.options.getString("type", true) as "word" | "math";
      await interaction.reply({ content: `Starting a ${type} race.`, ephemeral: true });
      await startGame(interaction.channel, type);
      return;
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
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4f4f4).setTitle(command === "winner" ? "Weekly winners" : "Weekly leaderboard").setDescription(body)] });
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
      await db.insert(auditLogs).values({ guildId: interaction.guildId!, actorId: interaction.user.id, action: "xp.reset-member", metadata: { userId: user.id } });
      return interaction.reply({ content: `Reset all XP for <@${user.id}>.`, ephemeral: true });
    }
    if (command === "refresh") {
      const scope = interaction.options.getString("scope", true);
      if (scope === "points") {
        if (interaction.options.getString("confirmation") !== "RESET") throw new Error("Type RESET in confirmation to clear every member's points");
        await db.update(members).set({ xp: 0, weeklyXp: 0, cooldownUntil: null }).where(eq(members.guildId, interaction.guildId!));
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
    if (command === "botstatus") return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4f4f4).setTitle("Inochi status").addFields(
      { name: "Servers", value: interaction.client.guilds.cache.size.toLocaleString(), inline: true },
      { name: "Ping", value: `${interaction.client.ws.ping} ms`, inline: true },
      { name: "Uptime", value: `${Math.floor(interaction.client.uptime / 60_000)} min`, inline: true },
    )] });
    if (command === "import") return handleImport(interaction);
    if (command === "guess") {
      if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) throw new Error("Choose a server text channel");
      await interaction.reply({ content: "Starting a word round.", ephemeral: true });
      await startWordGame(interaction.channel);
      return;
    }
    if (command === "calculate") {
      const guild = await settingsFor(interaction);
      const user = interaction.options.getUser("member") ?? interaction.user;
      const rank = await getRank(db, interaction.guildId!, user.id);
      const target = Math.min(interaction.options.getInteger("level", true), guild.settings.curve.maxLevel);
      const required = xpForLevel(target, guild.settings);
      const remaining = Math.max(0, required - (rank?.xp ?? 0));
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4f4f4).setTitle(`Level ${target} calculation`).setDescription(`<@${user.id}> needs **${remaining.toLocaleString()} XP** (${required.toLocaleString()} total).`)] });
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
    await replyError(interaction, error);
  }
}

export { syncMember };
