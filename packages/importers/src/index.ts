export const importProviderIds = ["mee6", "arcane", "probot", "amari", "lurkr", "carlbot", "tatsu"] as const;
export type ImportProviderId = typeof importProviderIds[number];
export type ImportMetric = "xp" | "text_xp" | "voice_xp" | "server_score";
export type ImportStrategy = "web" | "message";
export type ImportSourceValue = ImportMetric | "level";
export type ImportKnownPreset = "mee6" | "lurkr" | "amari";

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
  components?: unknown[];
  attachments?: Array<{ name: string; contentType?: string }>;
}

export interface ParseResult {
  recognized: boolean;
  records: ImportRecord[];
  page?: number;
  currentPage?: number;
  totalPages?: number;
  warnings: string[];
}

export interface PublicImportResult {
  records: ImportRecord[];
  pages: number;
  expectedPages?: number;
  complete: boolean;
  warnings: string[];
}

export interface ImportProvider {
  id: ImportProviderId;
  label: string;
  botUserIds: readonly string[];
  strategies: readonly ImportStrategy[];
  sourceValue: ImportSourceValue;
  knownPreset?: ImportKnownPreset;
  messageInstructions: string;
  parseMessage(snapshot: LeaderboardMessageSnapshot): ParseResult;
  fetchPublic?: (guildId: string) => Promise<PublicImportResult>;
}

import { parseCompatibilityMessage, safeNumber, snowflake } from "./message-parsing";
import { parseAmariMessage, parseArcaneMessage, parseCarlBotMessage, parseLurkrMessage, parseMee6Message, parseProBotMessage, parseTatsuMessage } from "./provider-parsers";

const MAX_IMPORT_RECORDS = 100_000;
const MAX_PUBLIC_PAGES = 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PUBLIC_IMPORT_BUDGET_MS = 8 * 60_000;

interface LurkrPaginationMetadata {
  page?: unknown;
  currentPage?: unknown;
  limit?: unknown;
  perPage?: unknown;
  pageSize?: unknown;
  total?: unknown;
  totalPages?: unknown;
  pages?: unknown;
  lastPage?: unknown;
  pageCount?: unknown;
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
  let complete = false;
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
    if (body.players.length < 100) { complete = true; break; }
    if (records.size === before) { warnings.push("MEE6 returned a repeated or unparseable page; pagination stopped early."); break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (pages >= MAX_PUBLIC_PAGES) warnings.push(`MEE6 pagination stopped after ${MAX_PUBLIC_PAGES.toLocaleString()} pages.`);
  if (records.size >= MAX_IMPORT_RECORDS) warnings.push(`Import capped at ${MAX_IMPORT_RECORDS.toLocaleString()} members.`);
  return { records: [...records.values()].slice(0, MAX_IMPORT_RECORDS), pages, expectedPages: complete ? pages : undefined, complete, warnings };
}

async function fetchLurkr(guildId: string): Promise<PublicImportResult> {
  const records = new Map<string, ImportRecord>();
  let pages = 0;
  let expectedPages: number | undefined;
  let complete = false;
  let reportedPageCap = false;
  const warnings: string[] = [];
  const deadline = Date.now() + PUBLIC_IMPORT_BUDGET_MS;
  for (let page = 1; page <= MAX_PUBLIC_PAGES && records.size < MAX_IMPORT_RECORDS; page += 1) {
    if (Date.now() >= deadline) { warnings.push("Lurkr import stopped at the eight-minute interaction budget; review the partial result."); break; }
    const response = await publicJson(`https://api.lurkr.gg/v2/levels/${guildId}?page=${page}&limit=100`);
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 || response.status === 404 ? "Lurkr's public leaderboard is unavailable; use its official export or message capture" : `Lurkr returned ${response.status}`);
    const body = await response.json() as LurkrPaginationMetadata & {
      levels?: Array<{ userId?: unknown; xp?: unknown; level?: unknown }>;
      pagination?: LurkrPaginationMetadata;
      meta?: LurkrPaginationMetadata;
    };
    if (!Array.isArray(body.levels)) throw new Error("Lurkr returned an unsupported leaderboard response");
    pages += 1;
    const metadata = body.pagination ?? body.meta ?? body;
    const reportedPage = safeNumber(metadata.page ?? metadata.currentPage);
    const reportedLimit = safeNumber(metadata.limit ?? metadata.perPage ?? metadata.pageSize);
    const reportedTotal = safeNumber(metadata.total);
    const reportedPages = safeNumber(metadata.totalPages ?? metadata.pages ?? metadata.lastPage ?? metadata.pageCount);
    const calculatedPages = reportedTotal !== null && reportedLimit !== null && reportedLimit > 0
      ? Math.ceil(reportedTotal / reportedLimit)
      : null;
    const pageCount = reportedPages !== null && reportedPages > 0 ? reportedPages : calculatedPages;
    if (pageCount !== null && pageCount > 0) {
      reportedPageCap ||= pageCount > MAX_PUBLIC_PAGES;
      expectedPages = Math.min(pageCount, MAX_PUBLIC_PAGES);
    }
    if (reportedPage !== null && reportedPage !== page) {
      warnings.push(`Lurkr reported page ${reportedPage} while page ${page} was requested; pagination stopped early.`);
      break;
    }
    const before = records.size;
    for (const player of body.levels) {
      if (records.size >= MAX_IMPORT_RECORDS) break;
      const userId = String(player.userId ?? "");
      const xp = safeNumber(player.xp);
      const level = safeNumber(player.level) ?? undefined;
      if (snowflake.test(userId) && xp !== null) records.set(userId, { userId, xp, level, exact: true, metric: "xp", page });
    }
    if (records.size === before) { warnings.push("Lurkr returned a repeated or unparseable page; pagination stopped early."); break; }
    if (expectedPages !== undefined && page >= expectedPages) { complete = true; break; }
    const responseLimit = reportedLimit && reportedLimit > 0 ? reportedLimit : 100;
    if (expectedPages === undefined && body.levels.length < responseLimit) { complete = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (reportedPageCap) warnings.push(`Lurkr reported more than ${MAX_PUBLIC_PAGES.toLocaleString()} pages; pagination was capped.`);
  if (pages >= MAX_PUBLIC_PAGES) warnings.push(`Lurkr pagination stopped after ${MAX_PUBLIC_PAGES.toLocaleString()} pages.`);
  if (records.size >= MAX_IMPORT_RECORDS) warnings.push(`Import capped at ${MAX_IMPORT_RECORDS.toLocaleString()} members.`);
  if (reportedPageCap) complete = false;
  return { records: [...records.values()].slice(0, MAX_IMPORT_RECORDS), pages, expectedPages: expectedPages ?? (complete ? pages : undefined), complete, warnings };
}

export const importProviders: Record<ImportProviderId, ImportProvider> = {
  mee6: { id: "mee6", label: "MEE6", botUserIds: ["159985870458322944"], strategies: ["web", "message"], sourceValue: "xp", knownPreset: "mee6", messageInstructions: "Run MEE6's public leaderboard command and visit each page.", parseMessage: parseMee6Message, fetchPublic: fetchMee6 },
  arcane: { id: "arcane", label: "Arcane", botUserIds: ["437808476106784770", "1217870452253397082", "645343657075146772"], strategies: ["message"], sourceValue: "xp", messageInstructions: "Run Arcane's public /leaderboard command and visit each page.", parseMessage: parseArcaneMessage },
  probot: { id: "probot", label: "ProBot", botUserIds: ["282859044593598464"], strategies: ["message"], sourceValue: "text_xp", messageInstructions: "Run ProBot's public /top text leaderboard and visit each page.", parseMessage: parseProBotMessage },
  amari: { id: "amari", label: "AmariBot", botUserIds: ["339254240012664832"], strategies: ["message"], sourceValue: "xp", knownPreset: "amari", messageInstructions: "Run AmariBot's public leaderboard command and visit each page.", parseMessage: parseAmariMessage },
  lurkr: { id: "lurkr", label: "Lurkr", botUserIds: ["506186003816513538"], strategies: ["web", "message"], sourceValue: "xp", knownPreset: "lurkr", messageInstructions: "Run Lurkr's public leaderboard command and visit each page.", parseMessage: parseLurkrMessage, fetchPublic: fetchLurkr },
  carlbot: { id: "carlbot", label: "Carl-bot", botUserIds: ["235148962103951360"], strategies: ["message"], sourceValue: "level", messageInstructions: "Run Carl-bot's public /level leaderboard command and visit each page.", parseMessage: parseCarlBotMessage },
  tatsu: { id: "tatsu", label: "Tatsu", botUserIds: ["172002255350792192"], strategies: ["message"], sourceValue: "server_score", messageInstructions: "Run Tatsu's public server leaderboard (not global) and visit each page.", parseMessage: parseTatsuMessage },
};

export function isImportProviderId(value: string): value is ImportProviderId {
  return importProviderIds.includes(value as ImportProviderId);
}

export function providerForBotUserId(userId: string) {
  return Object.values(importProviders).find((candidate) => candidate.botUserIds.includes(userId));
}

export function parsePublicLeaderboardMessage(text: string, page?: number): ImportRecord[] {
  return parseCompatibilityMessage(text, page);
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
export { parseAmariMessage, parseArcaneMessage, parseCarlBotMessage, parseLurkrMessage, parseMee6Message, parseProBotMessage, parseTatsuMessage } from "./provider-parsers";
export { parseLegacyXpJson } from "./legacy-xp-json";
