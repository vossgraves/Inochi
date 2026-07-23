export const importProviderIds = ["mee6", "arcane", "probot", "amari", "lurkr", "carlbot", "tatsu"] as const;
export type ImportProviderId = typeof importProviderIds[number];
export type ImportMetric = "xp" | "text_xp" | "voice_xp" | "server_score";
export type ImportStrategy = "web" | "message";

export interface ImportRecord {
  userId: string;
  xp: number;
  level?: number;
  exact: boolean;
  metric: ImportMetric;
  page?: number;
}

export interface LeaderboardMessageSnapshot {
  content: string;
  embeds: Array<{
    author?: string;
    title?: string;
    description?: string;
    fields: Array<{ name: string; value: string }>;
    footer?: string;
    url?: string;
  }>;
  components?: string[];
  attachments?: Array<{ name: string; contentType?: string }>;
}

export interface ParseResult {
  recognized: boolean;
  records: ImportRecord[];
  page?: number;
  warnings: string[];
}

export interface PublicImportResult {
  records: ImportRecord[];
  pages: number;
  warnings: string[];
}

export interface ImportProvider {
  id: ImportProviderId;
  label: string;
  botUserIds: readonly string[];
  strategies: readonly ImportStrategy[];
  messageInstructions: string;
  parseMessage(snapshot: LeaderboardMessageSnapshot): ParseResult;
  fetchPublic?: (guildId: string) => Promise<PublicImportResult>;
}

const snowflake = /^\d{16,20}$/;
const MAX_IMPORT_RECORDS = 100_000;
const MAX_PUBLIC_PAGES = 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PUBLIC_IMPORT_BUDGET_MS = 8 * 60_000;

function safeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(/[,_\s]/g, "")) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function messageText(snapshot: LeaderboardMessageSnapshot) {
  return [
    snapshot.content,
    ...snapshot.embeds.flatMap((embed) => [embed.author, embed.title, embed.description, ...embed.fields.map((field) => `${field.name}: ${field.value}`), embed.footer, embed.url]),
    ...(snapshot.components ?? []),
    ...(snapshot.attachments ?? []).map((attachment) => attachment.name),
  ].filter(Boolean).join("\n");
}

function pageFrom(text: string) {
  const match = text.match(/(?:page|pg)\s*[:#]?\s*(\d+)(?:\s*(?:\/|of)\s*\d+)?/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseProviderMessage(snapshot: LeaderboardMessageSnapshot, metric: ImportMetric = "xp", assumeLeaderboard = false): ParseResult {
  const text = messageText(snapshot);
  const page = pageFrom(text);
  const records = new Map<string, ImportRecord>();
  const exactPatterns = [
    /<@!?(\d{16,20})>[^\n]*?(?:total\s*)?(?:xp|experience|exp|score)\s*[:=-]?\s*([\d,_ ]+)/gi,
    /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:xp|experience|exp|score)\b/gi,
    /(\d{16,20})[^\n]*?(?:total\s*)?(?:xp|experience|exp|score)\s*[:=-]?\s*([\d,_ ]+)/gi,
  ];
  for (const pattern of exactPatterns) {
    for (const match of text.matchAll(pattern)) {
      const userId = match[1] ?? "";
      const xp = safeNumber(match[2]);
      if (snowflake.test(userId) && xp !== null) records.set(userId, { userId, xp, level: undefined, exact: true, metric, page });
    }
  }
  const levelPatterns = [
    /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi,
    /(\d{16,20})[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi,
  ];
  for (const pattern of levelPatterns) {
    for (const match of text.matchAll(pattern)) {
      const userId = match[1] ?? "";
      const level = safeNumber(match[2]);
      if (snowflake.test(userId) && level !== null && !records.has(userId)) records.set(userId, { userId, xp: 0, level, exact: false, metric, page });
    }
  }
  const recognized = assumeLeaderboard || /leaderboard|rankings|top\s+(?:members|users|text|server)|(?:page|pg)\s*[:#]?\s*\d+/i.test(text);
  const warnings: string[] = [];
  if (recognized && records.size === 0) warnings.push("Leaderboard recognized, but it did not expose Discord member IDs with XP or level values.");
  if (!records.size && (snapshot.attachments?.length ?? 0) > 0) warnings.push("Image-only leaderboards cannot be imported safely.");
  return { recognized, records: recognized ? [...records.values()] : [], page, warnings };
}

async function publicJson(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Inochi/2.0 (server-owner initiated migration)", accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 10_000) : 500 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Public leaderboard request failed");
}

async function fetchMee6(guildId: string): Promise<PublicImportResult> {
  const records = new Map<string, ImportRecord>();
  let pages = 0;
  const warnings: string[] = [];
  const deadline = Date.now() + PUBLIC_IMPORT_BUDGET_MS;
  for (let page = 0; page < MAX_PUBLIC_PAGES && records.size < MAX_IMPORT_RECORDS; page += 1) {
    if (Date.now() >= deadline) { warnings.push("MEE6 import stopped at the eight-minute interaction budget; review the partial result."); break; }
    const response = await publicJson(`https://mee6.xyz/api/plugins/levels/leaderboard/${guildId}?page=${page}&limit=100`);
    if (!response.ok) throw new Error(response.status === 404 || response.status === 403 ? "MEE6's public leaderboard is unavailable for this server" : `MEE6 returned ${response.status}`);
    const body = await response.json() as { players?: Array<{ id?: unknown; xp?: unknown; level?: unknown }> };
    if (!Array.isArray(body.players)) throw new Error("MEE6 returned an unsupported leaderboard response");
    pages += 1;
    const before = records.size;
    for (const player of body.players) {
      if (records.size >= MAX_IMPORT_RECORDS) break;
      const userId = String(player.id ?? "");
      const xp = safeNumber(player.xp);
      const level = safeNumber(player.level) ?? undefined;
      if (snowflake.test(userId) && xp !== null) records.set(userId, { userId, xp, level, exact: true, metric: "xp", page });
    }
    if (body.players.length < 100) break;
    if (records.size === before) { warnings.push("MEE6 returned a repeated or unparseable page; pagination stopped early."); break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (pages >= MAX_PUBLIC_PAGES) warnings.push(`MEE6 pagination stopped after ${MAX_PUBLIC_PAGES.toLocaleString()} pages.`);
  if (records.size >= MAX_IMPORT_RECORDS) warnings.push(`Import capped at ${MAX_IMPORT_RECORDS.toLocaleString()} members.`);
  return { records: [...records.values()].slice(0, MAX_IMPORT_RECORDS), pages, warnings };
}

async function fetchLurkr(guildId: string): Promise<PublicImportResult> {
  const records = new Map<string, ImportRecord>();
  let pages = 0;
  const warnings: string[] = [];
  const deadline = Date.now() + PUBLIC_IMPORT_BUDGET_MS;
  for (let page = 1; page <= MAX_PUBLIC_PAGES && records.size < MAX_IMPORT_RECORDS; page += 1) {
    if (Date.now() >= deadline) { warnings.push("Lurkr import stopped at the eight-minute interaction budget; review the partial result."); break; }
    const response = await publicJson(`https://api.lurkr.gg/v2/levels/${guildId}?page=${page}`);
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 || response.status === 404 ? "Lurkr's public leaderboard is unavailable; use its official export or message capture" : `Lurkr returned ${response.status}`);
    const body = await response.json() as { levels?: Array<{ userId?: unknown; xp?: unknown; level?: unknown }> };
    if (!Array.isArray(body.levels)) throw new Error("Lurkr returned an unsupported leaderboard response");
    pages += 1;
    const before = records.size;
    for (const player of body.levels) {
      if (records.size >= MAX_IMPORT_RECORDS) break;
      const userId = String(player.userId ?? "");
      const xp = safeNumber(player.xp);
      const level = safeNumber(player.level) ?? undefined;
      if (snowflake.test(userId) && xp !== null) records.set(userId, { userId, xp, level, exact: true, metric: "xp", page });
    }
    if (body.levels.length < 100) break;
    if (records.size === before) { warnings.push("Lurkr returned a repeated or unparseable page; pagination stopped early."); break; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (pages >= MAX_PUBLIC_PAGES) warnings.push(`Lurkr pagination stopped after ${MAX_PUBLIC_PAGES.toLocaleString()} pages.`);
  if (records.size >= MAX_IMPORT_RECORDS) warnings.push(`Import capped at ${MAX_IMPORT_RECORDS.toLocaleString()} members.`);
  return { records: [...records.values()].slice(0, MAX_IMPORT_RECORDS), pages, warnings };
}

function provider(input: Omit<ImportProvider, "parseMessage"> & { metric?: ImportMetric; requiredMode?: RegExp; requiredModeMessage?: string }): ImportProvider {
  return {
    ...input,
    parseMessage: (snapshot) => {
      const result = parseProviderMessage(snapshot, input.metric);
      const text = messageText(snapshot);
      if (input.requiredMode && !input.requiredMode.test(text)) return { ...result, records: [], warnings: [...result.warnings, input.requiredModeMessage ?? "This is not the required leaderboard mode."] };
      if (input.id === "probot" && /\bvoice\b/i.test(text)) return { ...result, records: [], warnings: [...result.warnings, "ProBot voice leaderboards are not compatible with the text XP import."] };
      if (input.id === "tatsu" && /\bglobal\b/i.test(text)) return { ...result, records: [], warnings: [...result.warnings, "Use Tatsu's server leaderboard, not its global leaderboard."] };
      if (/\b(?:daily|weekly|monthly|today|week|month)\b/i.test(text)) return { ...result, records: [], warnings: [...result.warnings, "Timed leaderboards cannot be used as total XP imports."] };
      if (result.records.length && input.metric === "server_score") result.warnings.push("Tatsu server score will be imported one-to-one as Inochi XP.");
      if (result.records.length && input.metric === "voice_xp") result.warnings.push("Voice XP will be imported one-to-one as Inochi XP.");
      return result;
    },
  };
}

export const importProviders: Record<ImportProviderId, ImportProvider> = {
  mee6: provider({ id: "mee6", label: "MEE6", botUserIds: ["159985870458322944"], strategies: ["web", "message"], messageInstructions: "Run MEE6's public leaderboard command and visit each page.", fetchPublic: fetchMee6 }),
  arcane: provider({ id: "arcane", label: "Arcane", botUserIds: ["437808476106784770", "1217870452253397082", "645343657075146772"], strategies: ["message"], messageInstructions: "Run Arcane's public /leaderboard command and visit each page." }),
  probot: provider({ id: "probot", label: "ProBot", botUserIds: ["282859044593598464"], strategies: ["message"], messageInstructions: "Run ProBot's public /top text leaderboard and visit each page.", metric: "text_xp", requiredMode: /\btext\b/i, requiredModeMessage: "Use ProBot's text leaderboard, not voice or another ranking mode." }),
  amari: provider({ id: "amari", label: "AmariBot", botUserIds: ["339254240012664832"], strategies: ["message"], messageInstructions: "Run AmariBot's public leaderboard command and visit each page." }),
  lurkr: provider({ id: "lurkr", label: "Lurkr", botUserIds: ["506186003816513538"], strategies: ["web", "message"], messageInstructions: "Run Lurkr's public leaderboard command and visit each page.", fetchPublic: fetchLurkr }),
  carlbot: provider({ id: "carlbot", label: "Carl-bot", botUserIds: ["235148962103951360"], strategies: ["message"], messageInstructions: "Run Carl-bot's public /level leaderboard command and visit each page.", requiredMode: /\blevel(?:s|ing)?\b/i, requiredModeMessage: "Use Carl-bot's level leaderboard." }),
  tatsu: provider({ id: "tatsu", label: "Tatsu", botUserIds: ["172002255350792192"], strategies: ["message"], messageInstructions: "Run Tatsu's public server leaderboard (not global) and visit each page.", metric: "server_score", requiredMode: /\bserver\b/i, requiredModeMessage: "Use Tatsu's server leaderboard, not its global XP ranking." }),
};

export function isImportProviderId(value: string): value is ImportProviderId {
  return importProviderIds.includes(value as ImportProviderId);
}

export function providerForBotUserId(userId: string) {
  return Object.values(importProviders).find((candidate) => candidate.botUserIds.includes(userId));
}

export function parsePublicLeaderboardMessage(text: string, page?: number): ImportRecord[] {
  const result = parseProviderMessage({ content: `${text}${page ? `\nPage ${page}` : ""}`, embeds: [] }, "xp", true);
  return result.records;
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
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line, index) => {
    if (index === 0 && /id|user/i.test(line)) return [];
    const match = line.match(/^\s*"?(\d{16,20})"?\s*[,;\t]\s*"?([\d,_\s]+)"?\s*$/);
    const userId = match?.[1] ?? "";
    const xp = safeNumber(match?.[2]);
    return snowflake.test(userId) && xp !== null ? [{ userId, xp, exact: true, metric: "xp" as const }] : [];
  });
}

export { fetchMee6, fetchLurkr };
export { parseLegacyPolarisJson } from "./legacy-polaris";
