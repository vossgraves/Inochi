import type { ImportMetric, ImportRecord, LeaderboardMessageSnapshot, ParseResult } from "./index";

export const snowflake = /^\d{16,20}$/;

export function safeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(/[,_\s]/g, "")) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function componentText(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) return value.flatMap((item) => componentText(item, seen));

  const component = value as Record<string, unknown>;
  return ["content", "label", "value", "description", "placeholder", "text"]
    .flatMap((key) => componentText(component[key], seen))
    .concat(componentText(component.components, seen));
}

export function messageText(snapshot: LeaderboardMessageSnapshot) {
  return [
    snapshot.content,
    ...snapshot.embeds.flatMap((embed) => [embed.author, embed.title, embed.description, ...embed.fields.map((field) => `${field.name}: ${field.value}`), embed.footer, embed.url]),
    ...componentText(snapshot.components),
    ...(snapshot.attachments ?? []).map((attachment) => attachment.name),
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
}

export function paginationFrom(text: string) {
  const labeled = text.match(/(?:page|pg)\s*[:#]?\s*(\d+)\s*(?:(?:\/|of)\s*(\d+))?/i);
  const compact = labeled ? undefined : text.match(/(?:^|[\s[(])([1-9]\d*)\s*\/\s*([1-9]\d*)(?=$|[\s\])])/m);
  const currentPage = safeNumber(labeled?.[1] ?? compact?.[1]) ?? undefined;
  const totalPages = safeNumber(labeled?.[2] ?? compact?.[2]) ?? undefined;
  return { currentPage, totalPages };
}

export type RecordPattern = { pattern: RegExp; value: "exact" | "level" };

function recordsFrom(text: string, patterns: readonly RecordPattern[], metric: ImportMetric, page?: number) {
  const records = new Map<string, ImportRecord>();
  for (const { pattern, value } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const userId = match[1] ?? "";
      const parsed = safeNumber(match[2]);
      if (!snowflake.test(userId) || parsed === null) continue;
      if (value === "exact") records.set(userId, { userId, xp: parsed, level: undefined, exact: true, metric, page });
      else if (!records.has(userId)) records.set(userId, { userId, xp: 0, level: parsed, exact: false, metric, page });
    }
  }
  return [...records.values()];
}

const timedMode = /\b(?:daily|weekly|monthly|today|day|week|month|this\s+(?:week|month)|past\s+(?:day|week|month)|24\s*hours?|7\s*days?|30\s*days?)\b/i;

export interface MessageParserOptions {
  metric?: ImportMetric;
  recognized: RegExp;
  patterns: readonly RecordPattern[];
  reject?: (text: string) => string | undefined;
  conversionWarning?: string;
}

export function parseMessageSnapshot(snapshot: LeaderboardMessageSnapshot, options: MessageParserOptions): ParseResult {
  const text = messageText(snapshot);
  const { currentPage, totalPages } = paginationFrom(text);
  const recognized = options.recognized.test(text);
  const warnings: string[] = [];
  const rejection = timedMode.test(text)
    ? "Timed leaderboards cannot be used as total XP imports."
    : options.reject?.(text);
  let records = recognized && !rejection
    ? recordsFrom(text, options.patterns, options.metric ?? "xp", currentPage)
    : [];

  if (rejection && recognized) warnings.push(rejection);
  if (recognized && !rejection && records.length === 0) warnings.push("Leaderboard recognized, but it did not expose Discord member IDs with XP or level values.");
  if (!records.length && (snapshot.attachments?.length ?? 0) > 0) warnings.push("Image-only leaderboards cannot be imported safely.");
  if (records.length && options.conversionWarning) warnings.push(options.conversionWarning);
  if (!recognized) records = [];

  return { recognized, records, page: currentPage, currentPage, totalPages, warnings };
}

export function parseCompatibilityMessage(text: string, page?: number): ImportRecord[] {
  const pageText = page === undefined ? text : `${text}\nPage ${page}`;
  return parseMessageSnapshot({ content: pageText, embeds: [] }, {
    recognized: /[\s\S]*/,
    patterns: [
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:total\s*)?(?:xp|experience|exp|score)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:xp|experience|exp|score)\b/gi, value: "exact" },
      { pattern: /(\d{16,20})[^\n]*?(?:total\s*)?(?:xp|experience|exp|score)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
      { pattern: /(\d{16,20})[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
    ],
  }).records;
}
