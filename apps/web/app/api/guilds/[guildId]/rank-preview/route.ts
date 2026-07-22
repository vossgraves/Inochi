import { NextResponse } from "next/server";
import { rankCardSettingsSchema } from "@inochi/core";
import { renderRankCard } from "@inochi/rank-card";
import { backgroundUrl } from "@inochi/storage";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = rankCardSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid rank-card settings" }, { status: 400 });
  const avatarUrl = access.session.avatar
    ? `https://cdn.discordapp.com/avatars/${access.session.userId}/${access.session.avatar}.png?size=256`
    : "invalid://avatar-fallback";
  const image = await renderRankCard({
    username: access.session.username,
    avatarUrl,
    rank: 12,
    level: 28,
    xp: 38_351,
    currentLevelXp: 35_300,
    nextLevelXp: 39_300,
    progress: 3_051 / 4_000,
    accentColor: parsed.data.accentColor,
    backgroundUrl: backgroundUrl(parsed.data.backgroundKey),
    backgroundOverlay: parsed.data.backgroundOverlay,
    avatarShape: parsed.data.avatarShape,
    surface: parsed.data.surface,
    progressStyle: parsed.data.progressStyle,
  });
  return new Response(new Uint8Array(image), { headers: { "cache-control": "no-store", "content-type": "image/png" } });
}
