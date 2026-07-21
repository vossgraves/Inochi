import { createHash } from "node:crypto";
import { and, apiKeys, db, eq, gt, isNull, or } from "@inochi/database";

const windows = new Map<string, { count: number; reset: number }>();

export async function authenticateApi(request: Request, guildId: string, write = false) {
  const raw = request.headers.get("x-api-key");
  if (!raw) return null;
  const hash = createHash("sha256").update(raw).digest("hex");
  const key = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, hash), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))) });
  if (!key || !key.guildIds.includes(guildId) || (write && !key.writeAccess)) return null;
  const now = Date.now();
  const window = windows.get(key.id);
  if (!window || window.reset <= now) windows.set(key.id, { count: 1, reset: now + 60_000 });
  else if (window.count >= 1_500) return null;
  else window.count += 1;
  return key;
}
