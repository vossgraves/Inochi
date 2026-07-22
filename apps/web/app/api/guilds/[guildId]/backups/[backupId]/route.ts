import { NextResponse } from "next/server";
import { and, backupSnapshots, db, eq } from "@inochi/database";
import { requireGuildManager } from "../../../../../../lib/auth";

export async function GET(_: Request, context: { params: Promise<{ guildId: string; backupId: string }> }) {
  const { guildId, backupId } = await context.params;
  if (!await requireGuildManager(guildId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const snapshot = await db.query.backupSnapshots.findFirst({ where: and(eq(backupSnapshots.id, backupId), eq(backupSnapshots.guildId, guildId)) });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(snapshot.payload, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="inochi-${guildId}-${snapshot.createdAt.toISOString().slice(0, 10)}.json"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
