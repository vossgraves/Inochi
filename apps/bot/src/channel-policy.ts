import type { GuildSettings } from "@inochi/core";
import type { Message } from "discord.js";

export function channelHierarchy(message: Message) {
  const ids = [message.channel.id];
  if (!("parentId" in message.channel) || !message.channel.parentId) return ids;
  ids.push(message.channel.parentId);
  const parent = message.guild?.channels.cache.get(message.channel.parentId);
  if (parent && "parentId" in parent && parent.parentId) ids.push(parent.parentId);
  return [...new Set(ids)];
}

export function channelAllowsXp(message: Message, settings: GuildSettings) {
  if (message.channel.isThread() && !settings.channelPolicy.threadsEnabled) return false;
  const matched = channelHierarchy(message).some((id) => settings.channelPolicy.channelIds.includes(id));
  return settings.channelPolicy.mode === "allowlist" ? matched : !matched;
}
