import { NextResponse } from "next/server";
import { levelForXp } from "@inochi/core";
import { and, auditLogs, db, eq, getOrCreateGuild, markPersistentLeaderboardDirty, members } from "@inochi/database";
import { authenticateApi } from "../../../../../../../lib/api-auth";

export async function GET(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  const { guildId, userId } = await context.params;
  if (!/^\d{16,20}$/.test(guildId) || !/^\d{16,20}$/.test(userId)) return NextResponse.json({ error: "Invalid Discord ID" }, { status: 400 });
  if (!await authenticateApi(request, guildId)) return NextResponse.json({ error: "Unauthorized or rate limited" }, { status: 401 });
  const guild = await getOrCreateGuild(db, guildId);
  const member = await db.query.members.findFirst({ where: and(eq(members.guildId, guildId), eq(members.userId, userId)) });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...member, level: levelForXp(member.xp, guild.settings) });
}

export async function PATCH(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  const { guildId, userId } = await context.params;
  if (!/^\d{16,20}$/.test(guildId) || !/^\d{16,20}$/.test(userId)) return NextResponse.json({ error: "Invalid Discord ID" }, { status: 400 });
  const key = await authenticateApi(request, guildId, true);
  if (!key) return NextResponse.json({ error: "Write access required or rate limited" }, { status: 403 });
  const body = await request.json() as { xp?: unknown };
  const xp = Number(body.xp);
  if (!Number.isSafeInteger(xp) || xp < 0) return NextResponse.json({ error: "XP must be a nonnegative safe integer" }, { status: 400 });
  await getOrCreateGuild(db, guildId);
  const [member] = await db.insert(members).values({ guildId, userId, xp }).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp, updatedAt: new Date() } }).returning();
  await db.insert(auditLogs).values({ guildId, actorId: key.userId, action: "api.xp-set", metadata: { keyId: key.id, userId, xp } });
  await markPersistentLeaderboardDirty(db, guildId);
  return NextResponse.json(member);
}

export async function DELETE(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  const { guildId, userId } = await context.params;
  if (!/^\d{16,20}$/.test(guildId) || !/^\d{16,20}$/.test(userId)) return NextResponse.json({ error: "Invalid Discord ID" }, { status: 400 });
  const key = await authenticateApi(request, guildId, true);
  if (!key) return NextResponse.json({ error: "Write access required or rate limited" }, { status: 403 });
  await db.delete(members).where(and(eq(members.guildId, guildId), eq(members.userId, userId)));
  await db.insert(auditLogs).values({ guildId, actorId: key.userId, action: "api.xp-delete", metadata: { keyId: key.id, userId } });
  await markPersistentLeaderboardDirty(db, guildId);
  return NextResponse.json({ deleted: true });
}
