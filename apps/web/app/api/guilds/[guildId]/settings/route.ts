import { NextResponse } from "next/server";
import { guildSettingsSchema } from "@inochi/core";
import { and, auditLogs, configurePersistentLeaderboard, db, disablePersistentLeaderboard, eq, getOrCreateGuild, guilds, sql } from "@inochi/database";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

export async function GET(_: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const guild = await getOrCreateGuild(db, guildId, access.guild.name);
  return NextResponse.json({ guild: access.guild, settings: guild.settings, revision: guild.settingsRevision });
}

export async function PUT(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { settings?: unknown; expectedRevision?: unknown; completeSetup?: unknown } | null;
  const result = guildSettingsSchema.safeParse(body?.settings);
  if (!result.success) return NextResponse.json({ error: "Invalid settings", details: result.error.flatten() }, { status: 400 });
  if (result.data.rankCard.backgroundKey && !result.data.rankCard.backgroundKey.startsWith(`rank-backgrounds/guilds/${guildId}/`)) return NextResponse.json({ error: "Rank background does not belong to this server" }, { status: 400 });
  const expectedRevision = Number(body?.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return NextResponse.json({ error: "Invalid settings revision" }, { status: 400 });
  const guild = await getOrCreateGuild(db, guildId, access.guild.name);
  if (body?.completeSetup === true && !guild.joinedAt) return NextResponse.json({ error: "Add Inochi to this server before completing setup" }, { status: 409 });
  const revision = await db.transaction(async (tx) => {
    const [updated] = await tx.update(guilds).set({ settings: result.data, settingsRevision: sql`${guilds.settingsRevision} + 1`, updatedAt: new Date(), ...(body?.completeSetup === true ? { setupCompletedAt: new Date(), setupVersion: 1 } : {}) })
      .where(and(eq(guilds.id, guildId), eq(guilds.settingsRevision, expectedRevision))).returning({ revision: guilds.settingsRevision });
    if (!updated) return null;
    const persistent = result.data.leaderboard.persistent;
    if (result.data.enabled && result.data.leaderboard.enabled && persistent.enabled && persistent.channelId) {
      await configurePersistentLeaderboard(tx, { guildId, channelId: persistent.channelId });
    } else {
      await disablePersistentLeaderboard(tx, guildId);
    }
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: body?.completeSetup === true ? "setup.complete" : "settings.update" });
    return updated.revision;
  });
  if (!revision) return NextResponse.json({ error: "Settings changed in another tab. Reload before saving again." }, { status: 409 });
  return NextResponse.json({ settings: result.data, revision });
}
