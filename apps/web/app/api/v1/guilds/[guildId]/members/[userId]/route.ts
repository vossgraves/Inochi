import { and, eq, members } from "@inochi/database";
import { apiError, apiJson, authorizedGuild, db, memberDto, snowflakePattern } from "../../../../_lib/api";

export async function GET(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  const { guildId, userId } = await context.params;
  if (!snowflakePattern.test(userId)) return apiError(400, "bad_request", "userId must be a Discord snowflake");
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  const member = await db.query.members.findFirst({ where: and(eq(members.guildId, guildId), eq(members.userId, userId)) });
  if (!member) return apiError(404, "not_found", "Member not found");
  return apiJson(memberDto(member, loaded.guild.settings));
}
