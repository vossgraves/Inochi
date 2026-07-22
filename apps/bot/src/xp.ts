import type { Message } from "discord.js";
import { calculateMultiplier, levelForXp } from "@inochi/core";
import { activeVote, claimMessageXp, db, getOrCreateGuild } from "@inochi/database";
import { handleGuess } from "./games";
import { syncMember } from "./commands/handler";
import { channelAllowsXp, channelHierarchy } from "./channel-policy";

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function handleMessageXp(message: Message) {
  if (!message.guild || !message.member || message.author.bot || message.system) return;
  if (await handleGuess(message)) return;
  const guild = await getOrCreateGuild(db, message.guild.id, message.guild.name);
  const settings = guild.settings;
  if (!settings.enabled) return;
  if (settings.community.blacklistRoleIds.some((roleId) => message.member!.roles.cache.has(roleId))) return;
  if (!channelAllowsXp(message, settings)) return;
  if (settings.community.ignoredPrefixes.some((prefix) => message.content.startsWith(prefix))) return;
  const vote = settings.multipliers.vote.enabled ? await activeVote(db, message.author.id) : null;
  const voteActive = vote && Date.now() - vote.votedAt.getTime() < settings.multipliers.vote.durationHours * 3_600_000;
  const multiplier = calculateMultiplier(settings, {
    roleIds: message.member.roles.cache.sort((a, b) => b.position - a.position).map((role) => role.id),
    channelIds: channelHierarchy(message),
  });
  const finalMultiplier = multiplier * settings.multipliers.global * (voteActive ? settings.multipliers.vote.multiplier : 1);
  if (finalMultiplier <= 0) return;
  const minimum = Math.round(settings.gain.min * finalMultiplier);
  const maximum = Math.round(settings.gain.max * finalMultiplier);
  const oldXp = await db.query.members.findFirst({ where: (table, { and, eq }) => and(eq(table.guildId, message.guild!.id), eq(table.userId, message.author.id)) }).then((row) => row?.xp ?? 0);
  const awarded = await claimMessageXp(db, {
    guildId: message.guild.id,
    userId: message.author.id,
    amount: randomInt(Math.min(minimum, maximum), Math.max(minimum, maximum)),
    cooldownUntil: new Date(Date.now() + settings.gain.cooldownSeconds * 1_000),
    weekly: settings.community.weeklyXp,
  });
  if (!awarded) return;
  const oldLevel = levelForXp(oldXp, settings);
  const newLevel = levelForXp(awarded.xp, settings);
  if (newLevel <= oldLevel) return;
  await syncMember(message.member).catch(() => undefined);
  const levelUp = settings.levelUp;
  const shouldAnnounce = levelUp.enabled && (!levelUp.rewardsOnly || settings.rewards.some((reward) => reward.level > oldLevel && reward.level <= newLevel));
  const specificMatch = !levelUp.specificLevels.length || levelUp.specificLevels.includes(newLevel);
  const intervalMatch = (levelUp.until > 0 && newLevel > levelUp.until) || levelUp.every <= 1 || newLevel % levelUp.every === 0;
  if (!shouldAnnounce || newLevel < levelUp.minimumLevel || !specificMatch || !intervalMatch) return;
  const rewardNames = settings.rewards.filter((reward) => reward.level > oldLevel && reward.level <= newLevel).map((reward) => message.guild!.roles.cache.get(reward.roleId)?.name).filter(Boolean).join(", ");
  let content = levelUp.message
    .replaceAll("{user}", `<@${message.author.id}>`).replaceAll("{user.id}", message.author.id)
    .replaceAll("{user.username}", message.author.username).replaceAll("{guild.name}", message.guild.name)
    .replaceAll("{guild}", message.guild.name).replaceAll("{guild.id}", message.guild.id)
    .replaceAll("{level}", String(newLevel)).replaceAll("{xp}", awarded.xp.toLocaleString())
    .replaceAll("{roleRewardNames}", rewardNames).replaceAll("{roleRewards}", rewardNames);
  content = content.replace(/\{#roleRewardNames\}([\s\S]*?)\{\/roleRewardNames\}/g, rewardNames ? "$1" : "")
    .replace(/\{\^roleRewardNames\}([\s\S]*?)\{\/roleRewardNames\}/g, rewardNames ? "" : "$1");
  if (levelUp.channelId === "dm") await message.author.send(content).catch(() => undefined);
  else if (levelUp.channelId === "current" && message.channel.isSendable()) await message.channel.send(content);
  else {
    const channel = message.guild.channels.cache.get(levelUp.channelId);
    if (channel?.isSendable()) await channel.send(content);
  }
}
