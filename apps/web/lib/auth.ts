import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, eq, oauthSessions } from "@inochi/database";

const sessionCookie = "inochi_session";
const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_TIMEOUT_MS = 10_000;
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

const guildCache = new Map<string, { guilds: DiscordGuild[]; expiresAt: number }>();

export async function discordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const cacheKey = hashToken(accessToken);
  const cached = guildCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.guilds;

  const response = await discordFetch(`${DISCORD_API}/users/@me/guilds`, accessToken);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Discord session expired");
    throw new Error(`Discord guild request failed: ${response.status}`);
  }
  const guilds = await response.json() as DiscordGuild[];
  guildCache.set(cacheKey, { guilds, expiresAt: Date.now() + GUILD_CACHE_MS });
  return guilds;
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
