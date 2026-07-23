import type { ImportRecord } from "./index";

const snowflake = /^\d{16,20}$/;

function xpValue(value: unknown) {
  const parsed = typeof value === "string" ? Number(value.replaceAll(",", "")) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

// Compatibility parser for common ID-to-XP JSON exports.
export function parseLegacyXpJson(value: unknown): ImportRecord[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const users = (root.users ?? root.xp ?? root) as Record<string, unknown>;
  if (Array.isArray(users)) {
    return users.flatMap((entry) => {
      const item = entry as Record<string, unknown>;
      const userId = String(item.id ?? item.userId ?? "");
      const xp = xpValue(item.xp);
      return snowflake.test(userId) && xp !== null ? [{ userId, xp, exact: true, metric: "xp" as const }] : [];
    });
  }
  return Object.entries(users).flatMap(([userId, raw]) => {
    const item = typeof raw === "object" && raw ? raw as Record<string, unknown> : { xp: raw };
    const xp = xpValue(item.xp);
    return snowflake.test(userId) && xp !== null ? [{ userId, xp, exact: true, metric: "xp" as const }] : [];
  });
}
