import { NextResponse } from "next/server";
import { desc, eq } from "@inochi/database";
import { auditLogs, backupSnapshots, db } from "@inochi/database";
import { levelingBackupSchema } from "@inochi/core";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";
import { buildBackup, checksum } from "../../../../../lib/backups";

export async function GET(_: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  if (!await requireGuildManager(guildId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const snapshots = await db.select({ id: backupSnapshots.id, trigger: backupSnapshots.trigger, createdAt: backupSnapshots.createdAt, checksum: backupSnapshots.checksum })
    .from(backupSnapshots).where(eq(backupSnapshots.guildId, guildId)).orderBy(desc(backupSnapshots.createdAt)).limit(25);
  return NextResponse.json({ snapshots });
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const raw = await request.json().catch(() => ({})) as { payload?: unknown };
  const parsed = raw.payload ? levelingBackupSchema.safeParse(raw.payload) : null;
  if (parsed && !parsed.success) return NextResponse.json({ error: "Invalid or unsupported Inochi backup", details: parsed.error.flatten() }, { status: 400 });
  const payload = parsed?.data ?? await buildBackup(guildId);
  if (payload.guildId !== guildId) return NextResponse.json({ error: "Backup belongs to another server" }, { status: 400 });
  const [snapshot] = await db.insert(backupSnapshots).values({ guildId, createdBy: access.session.userId, trigger: "manual", checksum: checksum(payload), payload }).returning();
  await db.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "backup.create", metadata: { backupId: snapshot!.id, members: payload.members.length } });
  return NextResponse.json({ snapshot: { id: snapshot!.id, createdAt: snapshot!.createdAt, checksum: snapshot!.checksum }, preview: { members: payload.members.length, createdAt: payload.createdAt, settings: true } });
}
