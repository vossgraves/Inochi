export interface ImportRecord {
  userId: string;
  xp: number;
  level?: number;
  exact: boolean;
  metric: "xp" | "text_xp" | "voice_xp" | "server_score";
  page?: number;
}

const snowflake = /^\d{16,20}$/;

function safeNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value.replaceAll(",", "")) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseLurkrJson(value: unknown): ImportRecord[] {
  const levels = (value as { levels?: unknown[] })?.levels;
  if (!Array.isArray(levels)) return [];
  return levels.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const userId = String(item.userId ?? "");
    const xp = safeNumber(item.xp);
    const level = safeNumber(item.level) ?? undefined;
    return snowflake.test(userId) && xp !== null ? [{ userId, xp, level, exact: true, metric: "xp" as const }] : [];
  });
}

export function parseCsv(value: string): ImportRecord[] {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line, index) => {
    if (index === 0 && /id|user/i.test(line)) return [];
    const [rawId, rawXp] = line.split(/[;,\t]/).map((part) => part?.trim());
    const userId = rawId ?? "";
    const xp = safeNumber(rawXp);
    return snowflake.test(userId) && xp !== null ? [{ userId, xp, exact: true, metric: "xp" as const }] : [];
  });
}

export function parsePublicLeaderboardMessage(text: string, page?: number): ImportRecord[] {
  const records = new Map<string, ImportRecord>();
  const patterns = [
    /<@!?(\d{16,20})>[^\n]*?(?:xp|experience)\D{0,12}([\d,]+)/gi,
    /(?:#?\d+\D+)?<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\D{0,8}(\d+)/gi,
    /(\d{16,20})[^\n]*?(?:xp|experience)\D{0,12}([\d,]+)/gi,
  ];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const userId = match[1] ?? "";
      const amount = safeNumber(match[2]);
      if (!snowflake.test(userId) || amount === null) continue;
      const exact = patternIndex !== 1;
      records.set(userId, { userId, xp: exact ? amount : 0, level: exact ? undefined : amount, exact, metric: "xp", page });
    }
  }
  return [...records.values()];
}

export async function fetchMee6(guildId: string): Promise<ImportRecord[]> {
  const records: ImportRecord[] = [];
  for (let page = 0; page < 10_000; page += 1) {
    const response = await fetch(`https://mee6.xyz/api/plugins/levels/leaderboard/${guildId}?page=${page}&limit=100`, {
      headers: { "user-agent": "Inochi/2.0 (server-owner initiated migration)" },
    });
    if (!response.ok) throw new Error(`MEE6 returned ${response.status}`);
    const body = await response.json() as { players?: Array<{ id: string; xp: number; level?: number }> };
    const players = body.players ?? [];
    records.push(...players.flatMap((player) => snowflake.test(player.id) && Number.isSafeInteger(player.xp)
      ? [{ userId: player.id, xp: player.xp, level: player.level, exact: true, metric: "xp" as const, page }]
      : []));
    if (players.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return records;
}

export const sourceBotIds: Partial<Record<string, string>> = {
  mee6: "159985870458322944",
  arcane: "437808476106784770",
  probot: "282859044593598464",
  lurkr: "506186003816513538",
  amari: "339254240012664832",
  tatsu: "172002255350792192",
  carlbot: "235148962103951360",
};

export { parseLegacyPolarisJson } from "./legacy-polaris";
