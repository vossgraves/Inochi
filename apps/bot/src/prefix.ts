import { EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import { levelForXp, parseGuildSettings, progressForXp, xpForLevel } from "@inochi/core";
import {
  activeVote,
  and,
  auditLogs,
  db,
  desc,
  eq,
  getOrCreateGuild,
  getRank,
  guilds,
  members,
  rankProfiles,
  sql,
  xpPeriods,
  markPersistentLeaderboardDirty,
  markPersistentLeaderboardsForUserDirty,
} from "@inochi/database";
import { startCoinflipMessage } from "./coinflip";
import { startGame } from "./games";
import { showImportPanelMessage } from "./imports";
import { recordAudit, sendGuildLog } from "./logging";
import { backgroundUrl, deleteBackground, uploadBackground } from "./storage";
import { INOCHI_NAVY, WARNING_AMBER } from "./theme";
import { commandDetailComponents, commandOverviewComponents } from "./commands/help";
import { getCommandMetadata, resolvePrefixCommandMetadata } from "./commands/metadata";
import { renderLeaderboard } from "./leaderboard";

const managerCommands = new Set(["winner", "joinrole", "blacklist", "reset", "refresh", "addxp", "clear", "config", "rewardrole", "multiplier", "word", "maths", "xpchannel", "diagnose", "import", "setup"]);
const progressionCommands = new Set(["rank", "top", "word", "maths", "coinflip"]);

function booleanArg(value: string | undefined) {
  if (!value) return undefined;
  if (["on", "true", "yes", "enable", "enabled"].includes(value.toLowerCase())) return true;
  if (["off", "false", "no", "disable", "disabled"].includes(value.toLowerCase())) return false;
  throw new Error("Use on or off");
}

function integerArg(value: string | undefined, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a whole number`);
  return result;
}

async function saveSettings(guild: Awaited<ReturnType<typeof getOrCreateGuild>>, actorId: string, action: string) {
  const settings = parseGuildSettings(guild.settings);
  await db.update(guilds).set({ settings, settingsRevision: sql`${guilds.settingsRevision} + 1`, updatedAt: new Date() }).where(eq(guilds.id, guild.id));
  await db.insert(auditLogs).values({ guildId: guild.id, actorId, action });
  return settings;
}

export function commandAliases(command: string) {
  return getCommandMetadata(command as Parameters<typeof getCommandMetadata>[0])?.aliases ?? [command];
}

export function resolvePrefixCommand(name: string) {
  return resolvePrefixCommandMetadata(name)?.name;
}

export async function handlePrefixCommand(message: Message<true>, guildRow?: Awaited<ReturnType<typeof getOrCreateGuild>>) {
  const guild = guildRow ?? await getOrCreateGuild(db, message.guildId, message.guild.name);
  const configured = guild.settings.commands;
  if (!configured.prefixEnabled || !message.content.toLowerCase().startsWith(configured.prefix.toLowerCase())) return false;
  const input = message.content.slice(configured.prefix.length).trim();
  if (!input) return false;
  const [name, ...args] = input.split(/\s+/);
  const command = resolvePrefixCommand(name!);
  if (!command) return false;
  const manager = message.member!.permissions.has(PermissionFlagsBits.ManageGuild);
  if (managerCommands.has(command) && !manager) {
    await message.reply("Manage Server permission is required for that command.");
    return true;
  }
  try {
    if (progressionCommands.has(command) && !guild.settings.enabled) throw new Error("XP is disabled in this server");
    void sendGuildLog(message.client, message.guildId, "commandUsage", "Prefix command used", `<@${message.author.id}> used \`${configured.prefix}${command}\` in <#${message.channelId}>.`).catch(console.error);
    if (managerCommands.has(command)) void recordAudit(message.guildId, message.author.id, "command.admin", { command, channelId: message.channelId, source: "prefix" }).catch(console.error);
    if (command === "help") {
      const payload = args[0] ? commandDetailComponents(args[0], configured.prefix, "prefix") : commandOverviewComponents(configured.prefix);
      if (!payload) throw new Error(`Unknown command: ${args[0]}`);
      await message.reply(payload);
    } else if (command === "rank") {
      if (!guild.settings.rankCard.enabled) throw new Error("Rank cards are disabled in this server");
      const target = message.mentions.users.first() ?? message.author;
      const rank = await getRank(db, message.guildId, target.id);
      if (!rank || rank.xp <= 0) throw new Error(`${target.displayName} has not earned XP yet`);
      const progress = progressForXp(rank.xp, guild.settings);
      await message.reply(`**${target.displayName}** · Rank **#${rank.rank}** · Level **${progress.level}** · **${rank.xp.toLocaleString()} XP** · ${Math.round(progress.progress * 100)}% to next level`);
    } else if (command === "top") {
      if (!guild.settings.leaderboard.enabled) throw new Error("The leaderboard is disabled");
      const page = args.find((arg) => /^\d+$/.test(arg)) ? integerArg(args.find((arg) => /^\d+$/.test(arg)), "Page") : 1;
      if (page < 1) throw new Error("Page must be at least 1");
      const rendered = await renderLeaderboard(message.guild, guild.settings, { page, highlightedUserId: message.mentions.users.first()?.id, interactiveUserId: message.author.id });
      await message.reply(rendered.payload);
    } else if (command === "coinflip") {
      const opponent = message.mentions.members?.first();
      const wager = Number(args.find((arg) => /^\d+$/.test(arg)));
      const sideArg = args.find((arg) => /^(h|head|heads|t|tail|tails)$/i.test(arg));
      if (!opponent || !Number.isSafeInteger(wager) || !sideArg) throw new Error(`Usage: \`${configured.prefix}${name} @opponent wager heads|tails\``);
      await startCoinflipMessage(message, opponent, wager, sideArg.toLowerCase().startsWith("h") ? "heads" : "tails");
    } else if (command === "word" || command === "maths") {
      if (!message.channel.isTextBased() || message.channel.isDMBased()) throw new Error("Choose a server text channel");
      await startGame(message.channel, command === "word" ? "word" : "math");
    } else if (command === "botstatus") {
      await message.reply(`**Inochi status** · ${message.client.guilds.cache.size.toLocaleString()} servers · ${message.client.ws.shards.size} shard${message.client.ws.shards.size === 1 ? "" : "s"} · ${message.client.ws.ping} ms · ${Math.floor(message.client.uptime / 60_000)} min uptime`);
    } else if (command === "config" || command === "setup") {
      const suffix = command === "setup" ? "/setup" : "";
      await message.reply(`${process.env.APP_URL ?? "http://localhost:3000"}/dashboard/${message.guildId}${suffix}`);
    } else if (command === "weekly" || command === "winner") {
      const action = command === "winner" ? "winner" : (args[0]?.toLowerCase() ?? "show");
      if (!["show", "enable", "disable", "reset", "winner"].includes(action)) throw new Error(`Usage: \`${configured.prefix}${name} [show|enable|disable|reset]\``);
      if (["enable", "disable", "reset", "winner"].includes(action) && !manager) throw new Error("Manage Server is required for that action");
      if (action === "enable" || action === "disable") {
        guild.settings.community.weeklyXp = action === "enable";
        await saveSettings(guild, message.author.id, "settings.weekly");
        await message.reply(`Weekly XP is now **${action}d**.`);
      } else {
        if (!guild.settings.community.weeklyXp) throw new Error("Weekly XP is disabled");
        const rows = await db.select().from(members).where(and(eq(members.guildId, message.guildId), sql`${members.weeklyXp} > 0`)).orderBy(desc(members.weeklyXp)).limit(action === "winner" ? 3 : 10);
        if (action === "reset") {
          await db.update(members).set({ weeklyXp: 0 }).where(eq(members.guildId, message.guildId));
          await db.insert(auditLogs).values({ guildId: message.guildId, actorId: message.author.id, action: "weekly.reset" });
          await message.reply("Weekly XP reset.");
        } else await message.reply({ content: rows.map((row, index) => `\`${index + 1}\` <@${row.userId}> · **${row.weeklyXp.toLocaleString()} XP**`).join("\n") || "No weekly XP has been earned.", allowedMentions: { parse: [] } });
      }
    } else if (command === "joinrole") {
      const role = message.mentions.roles.first();
      guild.settings.community.joinRoleId = role?.id ?? null;
      await saveSettings(guild, message.author.id, "settings.join-role");
      await message.reply(role ? `${role} will be granted to new members.` : "Join role disabled.");
    } else if (command === "blacklist") {
      const action = args[0]?.toLowerCase() ?? "show";
      if (action === "show") await message.reply(guild.settings.community.blacklistRoleIds.map((id) => `<@&${id}>`).join(", ") || "No roles are blacklisted.");
      else {
        const role = message.mentions.roles.first();
        if (!role || !["add", "remove"].includes(action)) throw new Error(`Usage: \`${configured.prefix}${name} add|remove @role\``);
        guild.settings.community.blacklistRoleIds = guild.settings.community.blacklistRoleIds.filter((id) => id !== role.id);
        if (action === "add") guild.settings.community.blacklistRoleIds.push(role.id);
        await saveSettings(guild, message.author.id, "settings.blacklist");
        await message.reply(`${role.name} ${action === "add" ? "cannot earn XP" : "can earn XP again"}.`);
      }
    } else if (command === "reset" || command === "clear") {
      const user = message.mentions.users.first();
      if (!user) throw new Error(`Usage: \`${configured.prefix}${name} @member\``);
      const values = command === "reset" ? { xp: 0, weeklyXp: 0, cooldownUntil: null } : { cooldownUntil: null };
      await db.update(members).set(values).where(and(eq(members.guildId, message.guildId), eq(members.userId, user.id)));
      if (command === "reset") {
        await db.insert(auditLogs).values({ guildId: message.guildId, actorId: message.author.id, action: "xp.reset-member", metadata: { userId: user.id } });
        await markPersistentLeaderboardDirty(db, message.guildId);
      }
      await message.reply(command === "reset" ? `Reset all XP for ${user}.` : `Cleared ${user}'s cooldown.`);
    } else if (command === "refresh") {
      const scope = args[0]?.toLowerCase();
      if (scope === "points") {
        if (args[1] !== "RESET") throw new Error(`Usage: \`${configured.prefix}${name} points RESET\``);
        await db.update(members).set({ xp: 0, weeklyXp: 0, cooldownUntil: null }).where(eq(members.guildId, message.guildId));
        await markPersistentLeaderboardDirty(db, message.guildId);
        await db.insert(auditLogs).values({ guildId: message.guildId, actorId: message.author.id, action: "xp.reset-all" });
        await message.reply("All server points were reset.");
      } else if (scope === "roles") {
        const { syncMember } = await import("./commands/handler");
        const guildMembers = await message.guild.members.fetch();
        let changed = 0;
        for (const member of guildMembers.values()) {
          if (member.user.bot) continue;
          const result = await syncMember(member).catch(() => null);
          if (result) changed += result.add.length + result.remove.length;
        }
        await message.reply(`Reward roles refreshed with ${changed} role changes.`);
      } else throw new Error(`Usage: \`${configured.prefix}${name} roles\` or \`${configured.prefix}${name} points RESET\``);
    } else if (command === "calculate") {
      const level = integerArg(args.find((arg) => /^\d+$/.test(arg)), "Level");
      const user = message.mentions.users.first() ?? message.author;
      const rank = await getRank(db, message.guildId, user.id);
      const target = Math.min(Math.max(1, level), guild.settings.curve.maxLevel);
      const required = xpForLevel(target, guild.settings);
      await message.reply(`${user} needs **${Math.max(0, required - (rank?.xp ?? 0)).toLocaleString()} XP** to reach level **${target}** (${required.toLocaleString()} total).`);
    } else if (command === "sync") {
      const target = message.mentions.members?.first() ?? message.member!;
      if (target.id !== message.author.id && !manager) throw new Error("Manage Server is required to sync another member");
      const { syncMember } = await import("./commands/handler");
      const changes = await syncMember(target);
      await message.reply(`Roles synchronized. Added ${changes.add.length}, removed ${changes.remove.length}.`);
    } else if (command === "addxp") {
      const user = message.mentions.users.first();
      const numeric = args.filter((arg) => /^-?\d+$/.test(arg));
      if (!user || !numeric[0]) throw new Error(`Usage: \`${configured.prefix}${name} @member amount [add_xp|set_xp|add_levels|set_level]\``);
      const amount = integerArg(numeric[0], "Amount");
      const operation = args.find((arg) => ["add_xp", "set_xp", "add_levels", "set_level"].includes(arg)) ?? "add_xp";
      const current = await getRank(db, message.guildId, user.id);
      const oldXp = current?.xp ?? 0;
      const oldLevel = levelForXp(oldXp, guild.settings);
      const nextXp = operation === "set_xp" ? amount : operation === "set_level" ? xpForLevel(amount, guild.settings) : operation === "add_levels" ? xpForLevel(oldLevel + amount, guild.settings) : oldXp + amount;
      const xp = Math.max(0, nextXp);
      await db.insert(members).values({ guildId: message.guildId, userId: user.id, xp }).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp, updatedAt: new Date() } });
      if (levelForXp(oldXp, guild.settings) !== levelForXp(xp, guild.settings)) await markPersistentLeaderboardDirty(db, message.guildId);
      await db.insert(auditLogs).values({ guildId: message.guildId, actorId: message.author.id, action: "xp.modify", metadata: { userId: user.id, operation, amount, oldXp, newXp: xp } });
      await message.reply(`${user} now has **${xp.toLocaleString()} XP**.`);
    } else if (command === "rewardrole") {
      const role = message.mentions.roles.first();
      const level = integerArg(args.find((arg) => /^\d+$/.test(arg)), "Level");
      if (!role || level < 0) throw new Error(`Usage: \`${configured.prefix}${name} @role level [keep] [dont_sync]\``);
      guild.settings.rewards = guild.settings.rewards.filter((reward) => reward.roleId !== role.id);
      if (level > 0) guild.settings.rewards.push({ roleId: role.id, level, keep: args.includes("keep"), noSync: args.includes("dont_sync") });
      await saveSettings(guild, message.author.id, "settings.reward-role");
      await message.reply(level > 0 ? `${role} is now awarded at level ${level}.` : `Removed ${role} from rewards.`);
    } else if (command === "multiplier") {
      const type = args[0]?.toLowerCase();
      const value = Number(args.find((arg) => /^\d+(\.\d+)?$/.test(arg)));
      if (!Number.isFinite(value) || value < 0 || value > 100 || !["role", "channel"].includes(type ?? "")) throw new Error(`Usage: \`${configured.prefix}${name} role|channel @target value\``);
      if (type === "role") {
        const role = message.mentions.roles.first();
        if (!role) throw new Error("Mention a role");
        guild.settings.multipliers.roles = guild.settings.multipliers.roles.filter((item) => item.roleId !== role.id);
        if (value > 0) guild.settings.multipliers.roles.push({ roleId: role.id, multiplier: value });
      } else {
        const channel = message.mentions.channels.first();
        if (!channel) throw new Error("Mention a channel");
        guild.settings.multipliers.channels = guild.settings.multipliers.channels.filter((item) => item.channelId !== channel.id);
        if (value > 0) guild.settings.multipliers.channels.push({ channelId: channel.id, multiplier: value });
      }
      await saveSettings(guild, message.author.id, "settings.multiplier");
      await message.reply(value > 0 ? `${type} multiplier set to **${value}x**.` : "Multiplier removed.");
    } else if (command === "vote") {
      const vote = await activeVote(db, message.author.id);
      const active = vote && vote.expiresAt.getTime() > Date.now();
      const url = `https://top.gg/bot/${process.env.TOPGG_BOT_ID ?? process.env.DISCORD_CLIENT_ID}/vote`;
      await message.reply(active ? `Your **${guild.settings.multipliers.vote.multiplier}x chat XP** boost expires <t:${Math.floor(vote.expiresAt.getTime() / 1000)}:R>.\n${url}` : `Vote for Inochi to receive **${guild.settings.multipliers.vote.multiplier}x chat XP** for ${guild.settings.multipliers.vote.durationHours} hours.\n${url}`);
    } else if (command === "xpchannel") {
      const action = args[0]?.toLowerCase() ?? "list";
      if (action === "list") await message.reply(`Mode: **${guild.settings.channelPolicy.mode}** · Threads: **${guild.settings.channelPolicy.threadsEnabled ? "enabled" : "disabled"}**\n${guild.settings.channelPolicy.channelIds.map((id) => `<#${id}>`).join(", ") || "No locations configured."}`);
      else if (action === "mode") {
        const mode = args[1]?.toLowerCase();
        if (mode !== "allowlist" && mode !== "denylist") throw new Error(`Usage: \`${configured.prefix}${name} mode allowlist|denylist\``);
        guild.settings.channelPolicy.mode = mode;
        await saveSettings(guild, message.author.id, "settings.channel-policy");
        await message.reply(`Chat XP now uses **${mode}** mode.`);
      } else if (action === "threads") {
        guild.settings.channelPolicy.threadsEnabled = booleanArg(args[1]) ?? !guild.settings.channelPolicy.threadsEnabled;
        await saveSettings(guild, message.author.id, "settings.channel-threads");
        await message.reply(`Chat XP in eligible threads is **${guild.settings.channelPolicy.threadsEnabled ? "enabled" : "disabled"}**.`);
      } else if (action === "add" || action === "remove") {
        const channel = message.mentions.channels.first();
        if (!channel) throw new Error(`Usage: \`${configured.prefix}${name} ${action} #channel\``);
        guild.settings.channelPolicy.channelIds = guild.settings.channelPolicy.channelIds.filter((id) => id !== channel.id);
        if (action === "add") guild.settings.channelPolicy.channelIds.push(channel.id);
        await saveSettings(guild, message.author.id, "settings.channel-policy");
        await message.reply(`${channel} ${action === "add" ? "added to" : "removed from"} the ${guild.settings.channelPolicy.mode}.`);
      } else throw new Error(`Usage: \`${configured.prefix}${name} list|mode|add|remove|threads\``);
    } else if (command === "privacy") {
      const value = booleanArg(args[0]);
      const existing = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, message.author.id) });
      if (value === undefined) await message.reply(`Public leaderboard privacy is **${existing?.leaderboardPrivate ? "enabled" : "disabled"}**.`);
      else {
        await db.insert(rankProfiles).values({ userId: message.author.id, leaderboardPrivate: value }).onConflictDoUpdate({ target: rankProfiles.userId, set: { leaderboardPrivate: value, updatedAt: new Date() } });
        await markPersistentLeaderboardsForUserDirty(db, message.author.id);
        await message.reply(`Your identity will ${value ? "be anonymized" : "remain visible"} on public leaderboards.`);
      }
    } else if (command === "colour") {
      const value = args[0]?.toLowerCase();
      const colour = !value || value === "reset" ? null : value.startsWith("#") ? value : `#${value}`;
      if (colour && !/^#[0-9a-f]{6}$/i.test(colour)) throw new Error("Use a six-digit hex colour such as #f4f4f4");
      await db.insert(rankProfiles).values({ userId: message.author.id, colorMode: colour ? "custom" : "monochrome", color: colour }).onConflictDoUpdate({ target: rankProfiles.userId, set: { colorMode: colour ? "custom" : "monochrome", color: colour, updatedAt: new Date() } });
      await message.reply(colour ? `Rank-card colour set to **${colour}**.` : "Rank-card colour reset.");
    } else if (command === "background") {
      const action = args[0]?.toLowerCase() ?? "view";
      const profile = await db.query.rankProfiles.findFirst({ where: eq(rankProfiles.userId, message.author.id) });
      if (action === "view") await message.reply(backgroundUrl(profile?.backgroundKey) ?? "You do not have a custom background.");
      else if (action === "delete" || action === "reset") {
        if (profile?.backgroundKey) await deleteBackground(profile.backgroundKey).catch(() => undefined);
        await db.insert(rankProfiles).values({ userId: message.author.id, backgroundKey: null }).onConflictDoUpdate({ target: rankProfiles.userId, set: { backgroundKey: null, updatedAt: new Date() } });
        await message.reply("Rank-card background deleted.");
      } else if (action === "set") {
        const image = message.attachments.first();
        if (!image?.contentType?.startsWith("image/") || image.size > 5_000_000) throw new Error("Attach an image under 5 MB");
        const response = await fetch(image.url);
        if (!response.ok) throw new Error("Discord did not return the uploaded image");
        const key = await uploadBackground(message.author.id, new Uint8Array(await response.arrayBuffer()), image.contentType);
        if (profile?.backgroundKey) await deleteBackground(profile.backgroundKey).catch(() => undefined);
        await db.insert(rankProfiles).values({ userId: message.author.id, backgroundKey: key }).onConflictDoUpdate({ target: rankProfiles.userId, set: { backgroundKey: key, updatedAt: new Date() } });
        await message.reply("Rank-card background updated.");
      } else throw new Error(`Usage: \`${configured.prefix}${name} set|view|delete\``);
    } else if (command === "wrapped") {
      const year = String(new Date().getUTCFullYear());
      const rows = await db.select().from(xpPeriods).where(and(eq(xpPeriods.guildId, message.guildId), eq(xpPeriods.userId, message.author.id), sql`${xpPeriods.period} like ${`${year}-%`}`, sql`length(${xpPeriods.period}) = 7`)).orderBy(desc(xpPeriods.xp));
      const totalXp = rows.reduce((sum, row) => sum + row.xp, 0);
      const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0);
      await message.reply(`**${year} Inochi Wrapped** · **${totalXp.toLocaleString()} XP** from **${totalMessages.toLocaleString()} messages** · Most active month: **${rows[0]?.period ?? "No activity yet"}**.`);
    } else if (command === "diagnose") {
      const me = message.guild.members.me;
      const missingRewards = guild.settings.rewards.filter((reward) => !message.guild.roles.cache.has(reward.roleId)).length;
      const unmanageableRewards = me ? guild.settings.rewards.filter((reward) => { const role = message.guild.roles.cache.get(reward.roleId); return role && role.position >= me.roles.highest.position; }).length : guild.settings.rewards.length;
      const checks = [["XP system", guild.settings.enabled], ["Send messages", me?.permissions.has(PermissionFlagsBits.SendMessages) ?? false], ["Attach files", me?.permissions.has(PermissionFlagsBits.AttachFiles) ?? false], ["Manage roles", me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false], ["Reward references", missingRewards === 0], ["Reward hierarchy", unmanageableRewards === 0]] as const;
      await message.reply({ embeds: [new EmbedBuilder().setColor(checks.every(([, ok]) => ok) ? INOCHI_NAVY : WARNING_AMBER).setTitle("Inochi diagnostics").setDescription(checks.map(([label, ok]) => `${ok ? "✓" : "✕"} ${label}`).join("\n"))] });
    } else if (command === "import") {
      await showImportPanelMessage(message, args[0]?.toLowerCase());
    } else {
      throw new Error(`Prefix handler missing for ${command}`);
    }
  } catch (error) {
    await message.reply(`**Error:** ${error instanceof Error ? error.message : "Command failed"}`).catch(() => undefined);
  }
  return true;
}
