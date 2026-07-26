import type { ImportMetric, ImportRecord, LeaderboardMessageSnapshot, ParseResult } from "./index";

export const snowflake = /^\d{16,20}$/;

export function safeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(/[,_\s]/g, "")) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/*
  Components V2 leaderboards (Arcane, for one) list members as plain usernames
  rather than mentions, so the text carries no snowflake at all. The member ID
  is still recoverable: each row's avatar is a Discord CDN URL of the form
  cdn.discordapp.com/avatars/<userId>/<hash>.png. Reading url and media.url
  alongside the text keeps those IDs in play. Previously only content, label,
  value, description, placeholder and text were collected, so avatar links were
  discarded before parsing ever ran.
*/
function componentText(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) return value.flatMap((item) => componentText(item, seen));

  const component = value as Record<string, unknown>;
  return ["content", "label", "value", "description", "placeholder", "text", "url"]
    .flatMap((key) => componentText(component[key], seen))
    .concat(componentText(component.components, seen))
    .concat(componentText(component.accessory, seen))
    .concat(componentText(component.media, seen))
    .concat(componentText(component.items, seen));
}

export function messageText(snapshot: LeaderboardMessageSnapshot) {
  return [
    snapshot.content,
    ...snapshot.embeds.flatMap((embed) => [embed.author, embed.title, embed.description, ...embed.fields.map((field) => `${field.name}: ${field.value}`), embed.footer, embed.url]),
    ...componentText(snapshot.components),
    ...(snapshot.attachments ?? []).map((attachment) => attachment.name),
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
}

/*
  A Discord CDN avatar or member-avatar URL, which embeds the user's snowflake.
  Guild-specific avatars are /guilds/<guildId>/users/<userId>/avatars/<hash>,
  so the user ID is the LAST snowflake before /avatars, not the first.
*/
const avatarUserId = /cdn\.discordapp\.com\/(?:guilds\/\d{16,20}\/users\/(\d{16,20})\/avatars|avatars\/(\d{16,20}))\//gi;

export function avatarUserIds(text: string): string[] {
  return [...text.matchAll(avatarUserId)].flatMap((match) => {
    const id = match[1] ?? match[2];
    return id && snowflake.test(id) ? [id] : [];
  });
}

export function paginationFrom(text: string) {
  const labeled = text.match(/(?:page|pg)\s*[:#]?\s*(\d+)\s*(?:(?:\/|of)\s*(\d+))?/i);
  const compact = labeled ? undefined : text.match(/(?:^|[\s[(])([1-9]\d*)\s*\/\s*([1-9]\d*)(?=$|[\s\])])/m);
  const currentPage = safeNumber(labeled?.[1] ?? compact?.[1]) ?? undefined;
  const totalPages = safeNumber(labeled?.[2] ?? compact?.[2]) ?? undefined;
  return { currentPage, totalPages };
}

/*
  Amari (and others) lay each entry across several lines:

      🥇 <@308...>
      Level: 1
      Exp: 35/55

  Every pattern used to join the mention to its value with `[^\n]*?`, which
  cannot cross a newline, so those entries produced zero records even though the
  member ID was right there. WITHIN_ENTRY crosses newlines but refuses to pass
  another mention, which keeps a match inside a single entry rather than letting
  one member's ID pair with the next member's number.
*/
export const WITHIN_ENTRY = "(?:(?!<@)[\\s\\S]){0,160}?";

/** Builds `<@id> … value` patterns that work across a multi-line entry. */
export function mentionPattern(tail: string, flags = "gi") {
  return new RegExp(`<@!?(\\d{16,20})>${WITHIN_ENTRY}${tail}`, flags);
}

export type RecordPattern = { pattern: RegExp; value: "exact" | "level" };

/*
  A value written as "35/55" is progress inside the current level, not a total,
  and importing 35 as lifetime XP would be wrong. Amari's board is the common
  case. When the number is followed by a slash and another number, the exact
  reading is discarded so the level pattern can supply the record instead.
*/
function isFraction(text: string, matchEnd: number) {
  return /^\s*\/\s*\d/.test(text.slice(matchEnd, matchEnd + 8));
}

function recordsFrom(text: string, patterns: readonly RecordPattern[], metric: ImportMetric, page?: number) {
  const records = new Map<string, ImportRecord>();
  let sawFraction = false;
  for (const { pattern, value } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const userId = match[1] ?? "";
      const parsed = safeNumber(match[2]);
      if (!snowflake.test(userId) || parsed === null) continue;
      if (value === "exact") {
        if (match.index !== undefined && isFraction(text, match.index + match[0].length)) {
          sawFraction = true;
          continue;
        }
        // Patterns run most-specific first, so an earlier exact reading wins.
        // Without this a later, looser pattern could overwrite a good value.
        const existing = records.get(userId);
        if (existing?.exact) continue;
        records.set(userId, { userId, xp: parsed, level: undefined, exact: true, metric, page });
      } else if (!records.has(userId)) {
        records.set(userId, { userId, xp: 0, level: parsed, exact: false, metric, page });
      }
    }
  }
  return { records: [...records.values()], sawFraction };
}

/*
  Last resort for leaderboards that print plain usernames instead of mentions,
  so the text holds no snowflake at all. Every row still carries an avatar, and
  the avatar URL holds the member ID, so IDs and values can be paired by
  position.

  This is only safe when the two lists are the same length and appear in the
  same order, so it bails out otherwise, and it always attaches a warning: the
  import flow has a preview and an explicit Apply step, and this is exactly the
  kind of inference that should be reviewed before it is committed.
*/
function pairAvatarRows(text: string, metric: ImportMetric, page?: number) {
  const ids = avatarUserIds(text);
  if (ids.length < 2) return { records: [] as ImportRecord[], warning: undefined };

  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) return { records: [] as ImportRecord[], warning: undefined };

  const values: Array<{ value: number; kind: "exact" | "level" }> = [];
  for (const line of text.split(/\r?\n/)) {
    const exact = line.match(/(?:total\s*)?(?:xp|exp|experience|score|points?)\s*[:=-]?\s*([\d,_ ]+)/i)
      ?? line.match(/([\d,_]+)\s*(?:xp|exp|experience)\b/i);
    const level = line.match(/(?:level|lvl)\s*[:=-]?\s*(\d+)/i);
    const parsedExact = safeNumber(exact?.[1]);
    const parsedLevel = safeNumber(level?.[1]);
    if (parsedExact !== null) values.push({ value: parsedExact, kind: "exact" });
    else if (parsedLevel !== null) values.push({ value: parsedLevel, kind: "level" });
  }
  if (values.length !== unique.length) return { records: [] as ImportRecord[], warning: undefined };

  const records = unique.map((userId, index) => {
    const { value, kind } = values[index]!;
    return kind === "exact"
      ? { userId, xp: value, level: undefined, exact: true, metric, page }
      : { userId, xp: 0, level: value, exact: false, metric, page };
  });
  return {
    records,
    warning: `Member IDs were read from ${records.length} row avatars because this leaderboard prints usernames rather than mentions. Check the preview before applying.`,
  };
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
  const parsed = recognized && !rejection
    ? recordsFrom(text, options.patterns, options.metric ?? "xp", currentPage)
    : { records: [] as ImportRecord[], sawFraction: false };
  let records = parsed.records;

  if (parsed.sawFraction && records.some((record) => !record.exact)) {
    warnings.push("This leaderboard shows progress inside the current level rather than lifetime XP, so levels were imported and XP will be derived from your curve.");
  }

  // Only reached when the mention patterns found nothing, so this never
  // overrides a clean parse.
  if (recognized && !rejection && records.length === 0) {
    const paired = pairAvatarRows(text, options.metric ?? "xp", currentPage);
    if (paired.records.length) {
      records = paired.records;
      if (paired.warning) warnings.push(paired.warning);
    }
  }

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
