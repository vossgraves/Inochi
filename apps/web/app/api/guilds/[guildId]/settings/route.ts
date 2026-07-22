import { NextResponse } from "next/server";
import { guildSettingsSchema } from "@inochi/core";
import { and, auditLogs, db, eq, getOrCreateGuild, guilds, sql } from "@inochi/database";
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
  const body = await request.json().catch(() => null) as { settings?: unknown; expectedRevision?: unknown } | null;
  const result = guildSettingsSchema.safeParse(body?.settings);
  if (!result.success) return NextResponse.json({ error: "Invalid settings", details: result.error.flatten() }, { status: 400 });
  const expectedRevision = Number(body?.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return NextResponse.json({ error: "Invalid settings revision" }, { status: 400 });
  await getOrCreateGuild(db, guildId, access.guild.name);
  const revision = await db.transaction(async (tx) => {
    const [updated] = await tx.update(guilds).set({ settings: result.data, settingsRevision: sql`${guilds.settingsRevision} + 1`, updatedAt: new Date() })
      .where(and(eq(guilds.id, guildId), eq(guilds.settingsRevision, expectedRevision))).returning({ revision: guilds.settingsRevision });
    if (!updated) return null;
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "settings.update" });
    return updated.revision;
  });
  if (!revision) return NextResponse.json({ error: "Settings changed in another tab. Reload before saving again." }, { status: 409 });
  return NextResponse.json({ settings: result.data, revision });
}
