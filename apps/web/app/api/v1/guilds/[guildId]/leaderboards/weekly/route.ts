import { leaderboardResponse } from "../../../../_lib/leaderboard";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  return leaderboardResponse(request, (await context.params).guildId, "weekly");
}
