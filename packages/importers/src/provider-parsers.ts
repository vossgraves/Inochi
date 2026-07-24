import type { LeaderboardMessageSnapshot, ParseResult } from "./index";
import { parseMessageSnapshot, type RecordPattern } from "./message-parsing";

const mentionXp: readonly RecordPattern[] = [
  { pattern: /<@!?(\d{16,20})>[^\n]*?(?:total\s*)?(?:xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
  { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:xp|experience)\b/gi, value: "exact" },
  { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
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
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:xp|experience)\b/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
      { pattern: /(?:^|\n)\s*(\d{16,20})[^\n]*?(?:xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /(?:^|\n)\s*(\d{16,20})[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
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
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:text\s*)?(?:xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:text\s*)?(?:xp|experience)\b/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
    ],
  });
}

export function parseAmariMessage(snapshot: LeaderboardMessageSnapshot): ParseResult {
  return parseMessageSnapshot(snapshot, {
    recognized: /\bamari(?:bot)?\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+/i,
    patterns: [
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:total\s*)?(?:exp|xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:exp|xp|experience)\b/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
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
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:xp|experience)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:#=-]?\s*(\d+)/gi, value: "level" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?\(\s*(?:level|lvl)?\s*(\d+)\s*\)/gi, value: "level" },
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
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:server\s*)?(?:score|points?)\s*[:=-]?\s*([\d,_ ]+)/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?([\d,_]+)\s*(?:server\s*)?(?:score|points?)\b/gi, value: "exact" },
      { pattern: /<@!?(\d{16,20})>[^\n]*?(?:level|lvl)\s*[:=-]?\s*(\d+)/gi, value: "level" },
    ],
    conversionWarning: "Tatsu server score will be imported one-to-one as Inochi XP.",
  });
}
