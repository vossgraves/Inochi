import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiKeys, db } from "@inochi/database";
import { canManageGuild, discordGuilds, getSession, validMutationRequest } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { name?: string; guildIds?: string[]; writeAccess?: boolean };
  const manageable = new Set((await discordGuilds(session.accessToken)).filter(canManageGuild).map((guild) => guild.id));
  const guildIds = (body.guildIds ?? []).filter((id) => manageable.has(id));
  if (!guildIds.length) return NextResponse.json({ error: "Choose at least one manageable server" }, { status: 400 });
  const secret = `inochi_${randomBytes(30).toString("base64url")}`;
  const [key] = await db.insert(apiKeys).values({ userId: session.userId, name: String(body.name ?? "API key").slice(0, 60), keyHash: createHash("sha256").update(secret).digest("hex"), writeAccess: body.writeAccess ?? false, guildIds }).returning();
  return NextResponse.json({ id: key!.id, key: secret, warning: "This key is shown once." });
}
