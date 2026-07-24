import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseGuildSettings, type LevelingBackup } from "@inochi/core";
import { auditLogs, backupChecksum, backupSnapshots, db, eq, getOrCreateGuild, guilds, markPersistentLeaderboardDirty, members, sql } from "@inochi/database";
import { parseCsv, parseLegacyXpJson, parseLurkrJson } from "@inochi/importers";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

const MAX_BODY_BYTES = 10_500_000;
const MAX_IMPORT_RECORDS = 100_000;
const PREVIEW_TTL_MS = 15 * 60_000;
const sources = ["legacy-json", "lurkr", "csv"] as const;
type Source = typeof sources[number];
type ImportRecord = { userId: string; xp: number };

async function readBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { error: "Import is larger than 10 MB", status: 413 } as const;
  if (!request.body) return { error: "Request body is required", status: 400 } as const;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: "Import is larger than 10 MB", status: 413 } as const;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { value: value as Record<string, unknown> } as const;
  } catch {
    return { error: "Malformed JSON request body", status: 400 } as const;
  }
}

function normalize(source: Source, data: unknown) {
  let parsed: ImportRecord[];
  try {
    parsed = source === "lurkr" ? parseLurkrJson(data)
      : source === "csv" ? parseCsv(typeof data === "string" ? data : "")
      : parseLegacyXpJson(data);
  } catch {
    return { error: "Import file could not be parsed" } as const;
  }
  const unique = new Map(parsed.map((record) => [record.userId, { userId: record.userId, xp: record.xp }]));
  const records = [...unique.values()].slice(0, MAX_IMPORT_RECORDS);
  return {
    records,
    counts: {
      found: parsed.length,
      unique: records.length,
      duplicates: parsed.length - unique.size,
      truncated: Math.max(0, unique.size - records.length),
    },
  } as const;
}

function digest(source: Source, records: ImportRecord[]) {
  return createHash("sha256").update(JSON.stringify([source, records])).digest("base64url");
}

function signature(guildId: string, source: Source, expires: number, contentDigest: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(`${guildId}:${source}:${expires}:${contentDigest}`).digest("base64url");
}

function previewToken(guildId: string, source: Source, records: ImportRecord[]) {
  const expires = Date.now() + PREVIEW_TTL_MS;
  const contentDigest = digest(source, records);
  return `${expires}.${contentDigest}.${signature(guildId, source, expires, contentDigest)}`;
}

function validPreviewToken(token: unknown, guildId: string, source: Source, records: ImportRecord[]) {
  if (typeof token !== "string") return false;
  const [rawExpires, tokenDigest, tokenSignature] = token.split(".");
  const expires = Number(rawExpires);
  if (!rawExpires || !tokenDigest || !tokenSignature || !Number.isSafeInteger(expires) || expires < Date.now()) return false;
  const contentDigest = digest(source, records);
  if (tokenDigest !== contentDigest) return false;
  const expected = Buffer.from(signature(guildId, source, expires, contentDigest));
  const actual = Buffer.from(tokenSignature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await readBody(request);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  const source = typeof body.value.source === "string" && sources.includes(body.value.source as Source) ? body.value.source as Source : null;
  if (!source) return NextResponse.json({ error: "Unsupported import source" }, { status: 400 });
  if (body.value.action !== "preview" && body.value.action !== "apply") return NextResponse.json({ error: "Import action must be preview or apply" }, { status: 400 });
  const normalized = normalize(source, body.value.data);
  if ("error" in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const { records, counts } = normalized;
  if (!records.length) return NextResponse.json({ error: "No valid records found" }, { status: 400 });
  if (body.value.action === "preview") return NextResponse.json({ preview: counts, token: previewToken(guildId, source, records) });
  if (body.value.confirmation !== "IMPORT" || !validPreviewToken(body.value.token, guildId, source, records)) {
    return NextResponse.json({ error: "Preview expired or import content changed. Preview the file again." }, { status: 409 });
  }
  await getOrCreateGuild(db, guildId, access.guild.name);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${guildId}:import`}))`);
    await tx.execute(sql`select id from guilds where id = ${guildId} for update`);
    const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) throw new Error("Import guild not found");
    const now = new Date();
    await tx.execute(sql`select user_id from members where guild_id = ${guildId} order by user_id for update`);
    const existing = await tx.select().from(members).where(eq(members.guildId, guildId));
    const backup: LevelingBackup = {
      format: "inochi-leveling-backup", version: 1, createdAt: now.toISOString(), guildId, settings: parseGuildSettings(guild.settings),
      members: existing.map((member) => ({ userId: member.userId, xp: member.xp, weeklyXp: member.weeklyXp, messageCount: member.messageCount, cooldownUntil: member.cooldownUntil?.toISOString() ?? null, hidden: member.hidden })),
    };
    const [safety] = await tx.insert(backupSnapshots).values({ guildId, createdBy: access.session.userId, trigger: "pre_import", checksum: backupChecksum(backup), payload: backup }).returning({ id: backupSnapshots.id });
    if (!safety) throw new Error("Could not create pre-import safety backup");
    const sortedRecords = [...records].sort((a, b) => a.userId.localeCompare(b.userId));
    for (let offset = 0; offset < sortedRecords.length; offset += 500) {
      const batch = sortedRecords.slice(offset, offset + 500).map((record) => ({ guildId, userId: record.userId, xp: record.xp }));
      await tx.insert(members).values(batch).onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp: sql`excluded.xp`, updatedAt: now } });
    }
    await tx.insert(auditLogs).values({ guildId, actorId: access.session.userId, action: "xp.file-import", metadata: { source, count: records.length, backupId: safety.id } });
    await markPersistentLeaderboardDirty(tx, guildId, { now, coalesceMs: 0 });
  });
  return NextResponse.json({ imported: records.length });
}
