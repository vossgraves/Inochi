import { NextResponse } from "next/server";
import { guildSettingsSchema } from "@inochi/core";
import { auditLogs, db, eq, getOrCreateGuild, guilds } from "@inochi/database";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

export async function GET(_: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const guild = await getOrCreateGuild(db, guildId, access.guild.name);
  return NextResponse.json({ guild: access.guild, settings: guild.settings });
}

export async function PUT(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = guildSettingsSchema.safeParse(await request.json());
  if (!result.success) return NextResponse.json({ error: "Invalid settings", details: result.error.flatten() }, { status: 400 });
  await getOrCreateGuild(db, guildId, access.guild.name);
  await db.transaction(async (tx) => {
    await tx.update(guilds).set({ settings: result.data, updatedAt: new Date() }).where(eq(guilds.id, guildId));
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "settings.update" });
  });
  return NextResponse.json({ settings: result.data });
}
