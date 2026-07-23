import { NextResponse } from "next/server";
import { levelingBackupSchema } from "@inochi/core";
import { and, auditLogs, backupSnapshots, configurePersistentLeaderboard, db, disablePersistentLeaderboard, eq, guilds, markPersistentLeaderboardDirty, members, sql } from "@inochi/database";
import { requireGuildManager, validMutationRequest } from "../../../../../../../lib/auth";
import { buildBackup, checksum } from "../../../../../../../lib/backups";

export async function POST(request: Request, context: { params: Promise<{ guildId: string; backupId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId, backupId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { mode?: "merge" | "replace" | "settings"; confirmation?: string };
  if (body.confirmation !== "RESTORE") return NextResponse.json({ error: "Type RESTORE to confirm" }, { status: 400 });
  if (body.mode !== undefined && !["merge", "replace", "settings"].includes(body.mode)) return NextResponse.json({ error: "Invalid restore mode" }, { status: 400 });
  const snapshot = await db.query.backupSnapshots.findFirst({ where: and(eq(backupSnapshots.id, backupId), eq(backupSnapshots.guildId, guildId)) });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const payload = levelingBackupSchema.parse(snapshot.payload);
  if (checksum(payload) !== snapshot.checksum) return NextResponse.json({ error: "Backup checksum mismatch" }, { status: 409 });
  const safety = await buildBackup(guildId);
  const mode = body.mode ?? "replace";
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${guildId}:restore`}))`);
    await tx.insert(backupSnapshots).values({ guildId, createdBy: access.session.userId, trigger: "pre_restore", checksum: checksum(safety), payload: safety });
    await tx.update(guilds).set({ settings: payload.settings, settingsRevision: sql`${guilds.settingsRevision} + 1`, updatedAt: new Date() }).where(eq(guilds.id, guildId));
    if (mode !== "settings") {
      if (mode === "replace") await tx.delete(members).where(eq(members.guildId, guildId));
      for (const member of payload.members) await tx.insert(members).values({
        guildId, userId: member.userId, xp: member.xp, weeklyXp: member.weeklyXp, messageCount: member.messageCount,
        cooldownUntil: member.cooldownUntil ? new Date(member.cooldownUntil) : null, hidden: member.hidden,
      }).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp: member.xp, weeklyXp: member.weeklyXp, messageCount: member.messageCount, cooldownUntil: member.cooldownUntil ? new Date(member.cooldownUntil) : null, hidden: member.hidden, updatedAt: new Date() } });
    }
    const persistent = payload.settings.leaderboard.persistent;
    if (payload.settings.enabled && payload.settings.leaderboard.enabled && persistent.enabled && persistent.channelId) await configurePersistentLeaderboard(tx, { guildId, channelId: persistent.channelId });
    else await disablePersistentLeaderboard(tx, guildId);
    await markPersistentLeaderboardDirty(tx, guildId, { coalesceMs: 0 });
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "backup.restore", metadata: { backupId, mode, members: payload.members.length } });
  });
  return NextResponse.json({ restored: payload.members.length, mode });
}
