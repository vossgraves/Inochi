import type { GuildDto } from "@inochi/api-contract";
import { apiJson, authorizedGuild } from "../../_lib/api";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  const body: GuildDto = {
    id: loaded.guild.id,
    name: loaded.guild.name,
    icon: loaded.guild.icon,
    enabled: loaded.guild.settings.enabled,
    joinedAt: loaded.guild.joinedAt?.toISOString() ?? null,
    leaderboard: {
      enabled: loaded.guild.settings.leaderboard.enabled,
      minimumLevel: loaded.guild.settings.leaderboard.minLevel,
      maximumEntries: loaded.guild.settings.leaderboard.maxEntries || null,
    },
    weeklyXpEnabled: loaded.guild.settings.community.weeklyXp,
  };
  return apiJson(body);
}
