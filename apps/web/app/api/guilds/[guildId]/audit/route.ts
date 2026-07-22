import { NextResponse } from "next/server";
import { auditLogs, db, desc, eq } from "@inochi/database";
import { requireGuildManager } from "../../../../../lib/auth";

export async function GET(_: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  if (!await requireGuildManager(guildId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db.select({ id: auditLogs.id, actorId: auditLogs.actorId, action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(eq(auditLogs.guildId, guildId)).orderBy(desc(auditLogs.createdAt)).limit(100);
  return NextResponse.json({ events: rows }, { headers: { "cache-control": "private, no-store" } });
}
