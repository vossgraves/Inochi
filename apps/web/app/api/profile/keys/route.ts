import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, apiKeys, db, eq, isNull, sql } from "@inochi/database";
import { canManageGuild, discordGuilds, getSession, validMutationRequest } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { name?: string; guildIds?: string[] };
  const manageable = new Set((await discordGuilds(session.accessToken)).filter(canManageGuild).map((guild) => guild.id));
  const guildIds = (body.guildIds ?? []).filter((id) => manageable.has(id));
  if (!guildIds.length) return NextResponse.json({ error: "Choose at least one manageable server" }, { status: 400 });
  const secret = `inochi_${randomBytes(30).toString("base64url")}`;
  const [key] = await db.insert(apiKeys).values({ userId: session.userId, name: String(body.name ?? "API key").slice(0, 60), keyHash: createHash("sha256").update(secret).digest("hex"), writeAccess: false, guildIds: [guildIds[0]!], expiresAt: new Date(Math.min(session.expiresAt.getTime(), Date.now() + 7 * 86_400_000)) }).returning();
  return NextResponse.json({ id: key!.id, key: secret, expiresAt: key!.expiresAt, warning: "This read-only key is shown once." }, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guildId = new URL(request.url).searchParams.get("guildId");
  if (!guildId || !(await discordGuilds(session.accessToken)).some((guild) => guild.id === guildId && canManageGuild(guild))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db.select({ id: apiKeys.id, userId: apiKeys.userId, name: apiKeys.name, writeAccess: apiKeys.writeAccess, expiresAt: apiKeys.expiresAt, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys).where(and(isNull(apiKeys.revokedAt), sql`${apiKeys.guildIds} @> ${JSON.stringify([guildId])}::jsonb`));
  return NextResponse.json({ keys: rows }, { headers: { "cache-control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const key = typeof body?.id === "string" ? await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, body.id) }) : null;
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const manageable = new Set((await discordGuilds(session.accessToken)).filter(canManageGuild).map((guild) => guild.id));
  if (key.userId !== session.userId && !key.guildIds.every((guildId) => manageable.has(guildId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return NextResponse.json({ revoked: true });
}
