import { NextResponse } from "next/server";
import { auditLogs, db, eq, getOrCreateGuild, markPersistentLeaderboardDirty, members } from "@inochi/database";
import { parseCsv, parseLegacyPolarisJson, parseLurkrJson } from "@inochi/importers";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

export async function GET(_: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const guild = await getOrCreateGuild(db, guildId, access.guild.name);
  const users = await db.select().from(members).where(eq(members.guildId, guildId));
  return NextResponse.json({ version: 2, settings: guild.settings, users: Object.fromEntries(users.map((user) => [user.userId, { xp: user.xp, cooldown: user.cooldownUntil?.getTime() ?? 0, hidden: user.hidden }])) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 10_000_000) return NextResponse.json({ error: "Import is larger than 10 MB" }, { status: 413 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { source?: string; data?: unknown };
  const records = body.source === "lurkr" ? parseLurkrJson(body.data)
    : body.source === "csv" ? parseCsv(String(body.data ?? ""))
    : parseLegacyPolarisJson(body.data);
  if (!records.length) return NextResponse.json({ error: "No valid records found" }, { status: 400 });
  await getOrCreateGuild(db, guildId, access.guild.name);
  await db.transaction(async (tx) => {
    for (const record of records) await tx.insert(members).values({ guildId, userId: record.userId, xp: record.xp }).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp: record.xp, updatedAt: new Date() } });
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "xp.file-import", metadata: { source: body.source ?? "legacy-polaris", count: records.length } });
    await markPersistentLeaderboardDirty(tx, guildId);
  });
  return NextResponse.json({ imported: records.length });
}
