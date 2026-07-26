import type { LeaderboardMessageSnapshot, ParseResult } from "./index";
import { mentionPattern, parseMessageSnapshot, WITHIN_ENTRY, type RecordPattern } from "./message-parsing";

/*
  Every mention pattern joins the ID to its value with WITHIN_ENTRY rather than
  `[^\n]*?`. Entries that span several lines, which is how Amari and several
  others format their boards, previously produced zero records because the
  value sat on the line after the mention and `[^\n]` could never reach it.
*/
const mentionXp: readonly RecordPattern[] = [
  { pattern: mentionPattern("(?:total\\s*)?(?:xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
  { pattern: mentionPattern("([\\d,_]+)[ \\t]*(?:xp|experience)\\b"), value: "exact" },
  { pattern: mentionPattern("(?:level|lvl)\\s*[:=-]?\\s*(\\d+)"), value: "level" },
];

export function parseMee6Message(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\bmee6\b|\bleaderboard\b|\bpage\s*[:#]?\s*\d+/i,
    patterns: mentionXp,
  });
}

export function parseArcaneMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\barcane\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+/i,
    patterns: [
      { pattern: mentionPattern("(?:xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
      { pattern: mentionPattern("([\\d,_]+)[ \\t]*(?:xp|experience)\\b"), value: "exact" },
      { pattern: mentionPattern("(?:level|lvl)\\s*[:=-]?\\s*(\\d+)"), value: "level" },
      // Bare snowflakes at the start of a row, for boards that print raw IDs.
      { pattern: new RegExp(`(?:^|\\n)\\s*(\\d{16,20})${WITHIN_ENTRY}(?:xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)`, "gi"), value: "exact" },
      { pattern: new RegExp(`(?:^|\\n)\\s*(\\d{16,20})${WITHIN_ENTRY}(?:level|lvl)\\s*[:=-]?\\s*(\\d+)`, "gi"), value: "level" },
    ],
  });
}

export function parseProBotMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    metric: "text_xp",
    recognized: /\bprobot\b|\bleaderboard\b|\btop\s+(?:text|voice)\b|\bpage\s*[:#]?\s*\d+/i,
    reject: (text) => {
      if (/\bvoice\b/i.test(text)) return "ProBot voice leaderboards are not compatible with the text XP import.";
      if (!/\btext\b/i.test(text)) return "Use ProBot's text leaderboard, not voice or another ranking mode.";
      return undefined;
    },
    patterns: [
      { pattern: mentionPattern("(?:text\\s*)?(?:xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
      { pattern: mentionPattern("([\\d,_]+)[ \\t]*(?:text\\s*)?(?:xp|experience)\\b"), value: "exact" },
      { pattern: mentionPattern("(?:level|lvl)\\s*[:=-]?\\s*(\\d+)"), value: "level" },
    ],
  });
}

export function parseAmariMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\bamari(?:bot)?\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+/i,
    patterns: [
      // Amari prints "Exp: 35/55", which is progress inside the current level
      // rather than lifetime XP. recordsFrom detects the slash and drops the
      // exact reading, so the level pattern below supplies the record instead.
      { pattern: mentionPattern("(?:total\\s*)?(?:exp|xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
      { pattern: mentionPattern("([\\d,_]+)[ \\t]*(?:exp|xp|experience)\\b"), value: "exact" },
      { pattern: mentionPattern("(?:level|lvl)\\s*[:=-]?\\s*(\\d+)"), value: "level" },
    ],
  });
}

export function parseLurkrMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\blurkr\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+/i,
    patterns: mentionXp,
  });
}

export function parseCarlBotMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\bcarl(?:-?bot)?\b|\blevel(?:s|ing)?\s+leaderboard\b|\bleaderboard\b|\bpage\s*[:#]?\s*\d+/i,
    reject: (text) => /\blevel(?:s|ing)?\b/i.test(text) ? undefined : "Use Carl-bot's level leaderboard.",
    patterns: [
      { pattern: mentionPattern("(?:xp|experience)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
      { pattern: mentionPattern("(?:level|lvl)\\s*[:#=-]?\\s*(\\d+)"), value: "level" },
      { pattern: mentionPattern("\\(\\s*(?:level|lvl)?\\s*(\\d+)\\s*\\)"), value: "level" },
    ],
  });
}

export function parseTatsuMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    metric: "server_score",
    recognized: /\btatsu\b|\b(?:server|global)\s+(?:score\s+)?leaderboard\b|\bleaderboard\b|\bpage\s*[:#]?\s*\d+/i,
    reject: (text) => {
      if (/\bglobal\b/i.test(text)) return "Use Tatsu's server leaderboard, not its global leaderboard.";
      if (!/\bserver\b/i.test(text)) return "Use Tatsu's server leaderboard, not its global XP ranking.";
      return undefined;
    },
    patterns: [
      { pattern: mentionPattern("(?:server\\s*)?(?:score|points?)\\s*[:=-]?\\s*([\\d,_ ]+)"), value: "exact" },
      { pattern: mentionPattern("([\\d,_]+)[ \\t]*(?:server\\s*)?(?:score|points?)\\b"), value: "exact" },
      { pattern: mentionPattern("(?:level|lvl)\\s*[:=-]?\\s*(\\d+)"), value: "level" },
    ],
    conversionWarning: "Tatsu server score will be imported one-to-one as Inochi XP.",
  });
}
