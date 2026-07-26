import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, eq, oauthSessions } from "@inochi/database";

const sessionCookie = "inochi_session";
const DISCORD_API = "https://discord.com/api/v10";
// 10s was tight enough that a slow Discord response looked like a hard failure.
const DISCORD_TIMEOUT_MS = 15_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const GUILD_CACHE_MS = 5 * 60 * 1000;

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace_")) throw new Error("SESSION_SECRET must contain at least 32 random characters");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decrypt(value: string) {
  const [rawIv, rawTag, rawEncrypted] = value.split(".");
  if (!rawIv || !rawTag || !rawEncrypted) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(rawIv, "base64url"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(rawEncrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function discordCredentials() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Discord credentials are not configured");
  return { clientId, clientSecret };
}

async function discordFetch(url: string, accessToken: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshDiscordToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number } | null> {
  try {
    const { clientId, clientSecret } = discordCredentials();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return null;
    const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in };
  } catch {
    return null;
  }
}

export async function createSession(input: { userId: string; username: string; avatar: string | null; accessToken: string; refreshToken?: string; expiresIn: number }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresIn * 1_000);
  await db.insert(oauthSessions).values({
    tokenHash: hashToken(token), userId: input.userId, username: input.username, avatar: input.avatar,
    accessToken: encrypt(input.accessToken), refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null, expiresAt,
  });
  const store = await cookies();
  store.set(sessionCookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(sessionCookie)?.value;
  if (!token) return null;
  const hashed = hashToken(token);
  const session = await db.query.oauthSessions.findFirst({ where: eq(oauthSessions.tokenHash, hashed) });
  if (!session) return null;

  const now = Date.now();
  const expiresAt = session.expiresAt.getTime();

  if (expiresAt - now <= REFRESH_BUFFER_MS) {
    if (!session.refreshToken) {
      await db.delete(oauthSessions).where(eq(oauthSessions.tokenHash, hashed));
      store.delete(sessionCookie);
      return null;
    }
    const refreshed = await refreshDiscordToken(decrypt(session.refreshToken));
    if (!refreshed) {
      await db.delete(oauthSessions).where(eq(oauthSessions.tokenHash, hashed));
      store.delete(sessionCookie);
      return null;
    }
    const newExpiresAt = new Date(now + refreshed.expiresIn * 1_000);
    const newAccessToken = encrypt(refreshed.accessToken);
    const newRefreshToken = refreshed.refreshToken ? encrypt(refreshed.refreshToken) : session.refreshToken;
    await db.update(oauthSessions).set({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    }).where(eq(oauthSessions.tokenHash, hashed));
    store.set(sessionCookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: newExpiresAt });
    return { ...session, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? null, expiresAt: newExpiresAt };
  }

  return { ...session, accessToken: decrypt(session.accessToken), refreshToken: session.refreshToken ? decrypt(session.refreshToken) : null };
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(sessionCookie)?.value;
  if (token) await db.delete(oauthSessions).where(eq(oauthSessions.tokenHash, hashToken(token)));
  store.delete(sessionCookie);
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/*
  Why the guild fetch fails matters, because each cause needs a different
  action from the user: re-authenticate, wait, or retry. The old code threw
  bare Errors and the dashboard caught them with `} catch {`, discarding the
  object, so every failure became the same dead end with nothing in the logs.
*/
export type GuildFetchReason = "expired" | "rate-limited" | "timeout" | "upstream";

export class GuildFetchError extends Error {
  constructor(
    readonly reason: GuildFetchReason,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(`discord_guilds_${reason}${status ? `_${status}` : ""}`);
    this.name = "GuildFetchError";
  }
}

const GUILD_CACHE_MAX = 500;
const FAILURE_CACHE_MS = 15_000;

type GuildCacheEntry =
  | { ok: true; guilds: DiscordGuild[]; expiresAt: number }
  | { ok: false; error: GuildFetchError; expiresAt: number };

const guildCache = new Map<string, GuildCacheEntry>();

// The old cache never evicted, so it grew one entry per access token forever.
function rememberGuilds(key: string, entry: GuildCacheEntry) {
  const now = Date.now();
  for (const [candidate, value] of guildCache) if (value.expiresAt <= now) guildCache.delete(candidate);
  if (guildCache.size >= GUILD_CACHE_MAX) {
    const oldest = guildCache.keys().next();
    if (!oldest.done) guildCache.delete(oldest.value);
  }
  guildCache.set(key, entry);
}

export function forgetGuilds(accessToken: string) {
  guildCache.delete(hashToken(accessToken));
}

function retryAfterMs(response: Response, body: unknown) {
  const header = Number(response.headers.get("retry-after"));
  const fromBody = typeof body === "object" && body && "retry_after" in body ? Number((body as { retry_after: unknown }).retry_after) : NaN;
  const seconds = Number.isFinite(fromBody) ? fromBody : Number.isFinite(header) ? header : 1;
  return Math.max(1_000, Math.min(60_000, seconds * 1_000));
}

async function fetchGuildsOnce(accessToken: string): Promise<DiscordGuild[]> {
  let response: Response;
  try {
    response = await discordFetch(`${DISCORD_API}/users/@me/guilds`, accessToken);
  } catch (error) {
    // AbortController fires AbortError once DISCORD_TIMEOUT_MS elapses.
    throw new GuildFetchError(error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream");
  }
  if (response.ok) return await response.json() as DiscordGuild[];
  if (response.status === 401) throw new GuildFetchError("expired", 401);
  if (response.status === 429) {
    const body = await response.json().catch(() => null);
    throw new GuildFetchError("rate-limited", 429, retryAfterMs(response, body));
  }
  throw new GuildFetchError("upstream", response.status);
}

export async function discordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const cacheKey = hashToken(accessToken);
  const cached = guildCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.ok) return cached.guilds;
    // Short-lived negative caching, so a failing dashboard on reload does not
    // hammer Discord and turn a transient problem into a sustained 429.
    throw cached.error;
  }

  try {
    const guilds = await fetchGuildsOnce(accessToken);
    rememberGuilds(cacheKey, { ok: true, guilds, expiresAt: Date.now() + GUILD_CACHE_MS });
    return guilds;
  } catch (error) {
    const failure = error instanceof GuildFetchError ? error : new GuildFetchError("upstream");
    // One retry, but only for the causes a retry can actually fix. Retrying a
    // 401 or a 429 makes both worse.
    if (failure.reason === "timeout" || (failure.reason === "upstream" && (failure.status ?? 500) >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const guilds = await fetchGuildsOnce(accessToken);
        rememberGuilds(cacheKey, { ok: true, guilds, expiresAt: Date.now() + GUILD_CACHE_MS });
        return guilds;
      } catch (retryError) {
        const retryFailure = retryError instanceof GuildFetchError ? retryError : new GuildFetchError("upstream");
        rememberGuilds(cacheKey, { ok: false, error: retryFailure, expiresAt: Date.now() + FAILURE_CACHE_MS });
        throw retryFailure;
      }
    }
    rememberGuilds(cacheKey, { ok: false, error: failure, expiresAt: Date.now() + FAILURE_CACHE_MS });
    throw failure;
  }
}

export function canManageGuild(guild: DiscordGuild) {
  const permissions = BigInt(guild.permissions);
  return guild.owner || (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
}

export async function requireGuildManager(guildId: string) {
  const session = await getSession();
  if (!session) return null;
  const guild = (await discordGuilds(session.accessToken)).find((item) => item.id === guildId);
  if (!guild || !canManageGuild(guild)) return null;
  return { session, guild };
}

export function validMutationRequest(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return origin === new URL(process.env.APP_URL ?? "http://localhost:3000").origin && (!site || site === "same-origin");
}
