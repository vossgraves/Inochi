import type { RewardsDto } from "@inochi/api-contract";
import { apiJson, authorizedGuild } from "../../../_lib/api";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  const body: RewardsDto = { rewards: loaded.guild.settings.rewards.map(({ roleId, level, keep, noSync }) => ({ roleId, level, keep, noSync })) };
  return apiJson(body);
}
