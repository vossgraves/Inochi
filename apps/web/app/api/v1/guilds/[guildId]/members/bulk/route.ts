import { MAX_BULK_MEMBER_IDS, type BulkMembersRequestDto, type BulkMembersResponseDto } from "@inochi/api-contract";
import { and, eq, inArray, members } from "@inochi/database";
import { apiError, apiJson, authorizedGuild, db, memberDto, snowflakePattern } from "../../../../_lib/api";

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const loaded = await authorizedGuild(request, guildId);
  if ("response" in loaded) return loaded.response;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError(400, "bad_request", "Request body must be valid JSON");
  }
  const userIds = (input as Partial<BulkMembersRequestDto> | null)?.userIds;
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > MAX_BULK_MEMBER_IDS || userIds.some((id) => typeof id !== "string" || !snowflakePattern.test(id))) {
    return apiError(400, "bad_request", `userIds must contain 1 to ${MAX_BULK_MEMBER_IDS} Discord snowflakes`);
  }
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length !== userIds.length) return apiError(400, "bad_request", "userIds must not contain duplicates");
  const rows = await db.select().from(members).where(and(eq(members.guildId, guildId), inArray(members.userId, uniqueIds)));
  const byId = new Map(rows.map((member) => [member.userId, member]));
  const body: BulkMembersResponseDto = {
    members: uniqueIds.flatMap((id) => {
      const member = byId.get(id);
      return member ? [memberDto(member, loaded.guild.settings)] : [];
    }),
    missingUserIds: uniqueIds.filter((id) => !byId.has(id)),
  };
  return apiJson(body);
}
