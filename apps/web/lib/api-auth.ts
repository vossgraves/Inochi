import { createHash } from "node:crypto";
import { and, apiKeys, db, desc, eq, gt, isNull, oauthSessions, or } from "@inochi/database";
import { canManageGuild, decrypt, discordGuilds } from "./auth";

const windows = new Map<string, { count: number; reset: number }>();
const authorizations = new Map<string, { allowed: boolean; expires: number }>();

export async function authenticateApi(request: Request, guildId: string, write = false) {
  const raw = request.headers.get("x-api-key");
  if (!raw) return null;
  const hash = createHash("sha256").update(raw).digest("hex");
  const key = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))) });
  if (!key || !key.guildIds.includes(guildId) || (write && !key.writeAccess)) return null;
  const authorizationId = `${key.userId}:${guildId}`;
  const cached = authorizations.get(authorizationId);
  let authorized = !write && cached && cached.expires > Date.now() ? cached.allowed : false;
  if (write || !cached || cached.expires <= Date.now()) {
    const session = await db.query.oauthSessions.findFirst({
      where: and(eq(oauthSessions.userId, key.userId), gt(oauthSessions.expiresAt, new Date())),
      orderBy: [desc(oauthSessions.createdAt)],
    });
    authorized = session ? await discordGuilds(decrypt(session.accessToken)).then((guilds) => guilds.some((guild) => guild.id === guildId && canManageGuild(guild))).catch(() => false) : false;
    authorizations.set(authorizationId, { allowed: authorized, expires: Date.now() + 30_000 });
  }
  if (!authorized) return null;
  const now = Date.now();
  const window = windows.get(key.id);
  if (!window || window.reset <= now) windows.set(key.id, { count: 1, reset: now + 60_000 });
  else if (window.count >= 1_500) return null;
  else window.count += 1;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return key;
}
