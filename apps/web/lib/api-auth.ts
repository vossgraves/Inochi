import { createHash } from "node:crypto";
import { and, apiKeys, db, desc, eq, gt, isNull, oauthSessions, or } from "@inochi/database";
import { canManageGuild, decrypt, discordGuilds } from "./auth";

const windows = new Map<string, { count: number; reset: number }>();
const authorizations = new Map<string, { allowed: boolean; expires: number }>();

export type ApiAuthenticationResult =
  | { authenticated: true; key: typeof apiKeys.$inferSelect }
  | { authenticated: false; reason: "unauthorized" }
  | { authenticated: false; reason: "rate_limited"; retryAfterSeconds: number };

export async function authenticateApiRequest(request: Request, guildId: string, write = false): Promise<ApiAuthenticationResult> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const raw = bearer || request.headers.get("x-api-key")?.trim();
  if (!raw) return { authenticated: false, reason: "unauthorized" };
  const hash = createHash("sha256").update(raw).digest("hex");
  const key = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))) });
  if (!key || !key.guildIds.includes(guildId) || (write && !key.writeAccess)) return { authenticated: false, reason: "unauthorized" };
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
  if (!authorized) return { authenticated: false, reason: "unauthorized" };
  const now = Date.now();
  const window = windows.get(key.id);
  if (!window || window.reset <= now) windows.set(key.id, { count: 1, reset: now + 60_000 });
  else if (window.count >= 1_500) return { authenticated: false, reason: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil((window.reset - now) / 1_000)) };
  else window.count += 1;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { authenticated: true, key };
}

export async function authenticateApi(request: Request, guildId: string, write = false) {
  const result = await authenticateApiRequest(request, guildId, write);
  return result.authenticated ? result.key : null;
}
