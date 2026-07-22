import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, db, eq, gt, oauthSessions } from "@inochi/database";

const sessionCookie = "inochi_session";

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
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  const session = await db.query.oauthSessions.findFirst({ where: and(eq(oauthSessions.tokenHash, hashToken(token)), gt(oauthSessions.expiresAt, new Date())) });
  if (!session) return null;
  return { ...session, accessToken: decrypt(session.accessToken) };
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

export async function discordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error("Discord guild request failed");
  return response.json();
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
