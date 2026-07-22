import { z } from "zod";

const snowflake = z.string().regex(/^\d{16,20}$/);

export const rankCardSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  ephemeral: z.boolean().default(false),
  showCooldown: z.boolean().default(true),
  relativeXp: z.boolean().default(true),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#8ba8ff"),
  backgroundKey: z.string().min(1).max(500).nullable().default(null),
  backgroundOverlay: z.number().min(0).max(0.95).default(0.86),
  avatarShape: z.enum(["rounded", "circle", "square"]).default("rounded"),
  surface: z.enum(["technical", "clean"]).default("technical"),
  progressStyle: z.enum(["solid", "glow"]).default("glow"),
});

export const guildSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  gain: z.object({
    min: z.number().int().min(0).max(5_000).default(50),
    max: z.number().int().min(0).max(5_000).default(100),
    cooldownSeconds: z.number().min(0).max(31_536_000).default(60),
  }).default({}),
  curve: z.object({
    constant: z.number().min(-1_000_000).max(1_000_000).default(0),
    cubic: z.number().min(-100).max(100).default(1),
    quadratic: z.number().min(-10_000).max(10_000).default(50),
    linear: z.number().min(-100_000).max(100_000).default(100),
    rounding: z.number().int().min(1).max(1_000).default(100),
    maxLevel: z.number().int().min(1).max(1_000).default(1_000),
  }).default({}),
  levelUp: z.object({
    enabled: z.boolean().default(false),
    message: z.string().max(6_000).default("Congratulations {user}, you reached level {level}!") ,
    channelId: z.union([snowflake, z.literal("current"), z.literal("dm")]).default("current"),
    rewardsOnly: z.boolean().default(false),
    every: z.number().int().min(1).max(1_000).default(1),
    until: z.number().int().min(0).max(1_000).default(20),
    minimumLevel: z.number().int().min(0).max(1_000).default(0),
    specificLevels: z.array(z.number().int().min(1).max(1_000)).max(100).default([]),
  }).default({}),
  rankCard: rankCardSettingsSchema.default({}),
  logging: z.object({
    channelId: z.union([snowflake, z.null()]).default(null),
    commandUsage: z.boolean().default(false),
    levelUps: z.boolean().default(true),
    adminActions: z.boolean().default(true),
    errors: z.boolean().default(true),
    backups: z.boolean().default(true),
  }).default({}),
  backups: z.object({
    enabled: z.boolean().default(false),
    cadence: z.enum(["daily", "weekly"]).default("weekly"),
    weekday: z.number().int().min(0).max(6).default(0),
    hourUtc: z.number().int().min(0).max(23).default(0),
    retentionDays: z.number().int().min(1).max(90).default(30),
  }).default({}),
  leaderboard: z.object({
    enabled: z.boolean().default(true),
    private: z.boolean().default(false),
    ephemeral: z.boolean().default(false),
    minLevel: z.number().int().min(0).max(1_000).default(0),
    maxEntries: z.number().int().min(0).max(1_000_000).default(0),
    visibility: z.enum(["public", "members", "managers"]).default("public"),
    vanitySlug: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable().default(null),
  }).default({}),
  rewards: z.array(z.object({
    roleId: snowflake,
    level: z.number().int().min(1).max(1_000),
    keep: z.boolean().default(false),
    noSync: z.boolean().default(false),
  })).default([]),
  multipliers: z.object({
    roles: z.array(z.object({ roleId: snowflake, multiplier: z.number().min(0).max(100) })).default([]),
    channels: z.array(z.object({ channelId: snowflake, multiplier: z.number().min(0).max(100) })).default([]),
    roleMode: z.enum(["largest", "smallest", "highest", "add", "combine"]).default("largest"),
    stackMode: z.enum(["multiply", "add", "largest", "channel", "role"]).default("multiply"),
    global: z.number().min(0).max(100).default(1),
    vote: z.object({
      enabled: z.boolean().default(true),
      multiplier: z.number().min(1).max(10).default(1.2),
      durationHours: z.number().min(1).max(168).default(12),
    }).default({}),
  }).default({}),
  games: z.object({
    rotation: z.object({
      enabled: z.boolean().default(false),
      channelIds: z.array(snowflake).default([]),
      intervalMinutes: z.number().int().min(1).max(10_080).default(60),
      mode: z.enum(["random", "round-robin"]).default("random"),
      types: z.array(z.enum(["word", "math"])).min(1).default(["word", "math"]),
    }).default({}),
    wordRace: z.object({
      enabled: z.boolean().default(true),
      answerSeconds: z.number().int().min(10).max(3_600).default(60),
      placeXp: z.array(z.number().int().min(0).max(100_000)).min(1).max(3).default([250, 150, 75]),
      hints: z.number().int().min(0).max(5).default(1),
      customWords: z.array(z.string().trim().min(2).max(40)).max(1_000).default([]),
    }).default({}),
    mathRace: z.object({
      enabled: z.boolean().default(true),
      answerSeconds: z.number().int().min(10).max(3_600).default(60),
      placeXp: z.array(z.number().int().min(0).max(100_000)).min(1).max(3).default([300, 175, 100]),
      difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("medium"),
    }).default({}),
  }).default({}),
  community: z.object({
    weeklyXp: z.boolean().default(false),
    clearOnLeave: z.boolean().default(false),
    joinRoleId: z.union([snowflake, z.null()]).default(null),
    blacklistRoleIds: z.array(snowflake).default([]),
    noRewardRoleIds: z.array(snowflake).default([]),
    ignoredPrefixes: z.array(z.string().min(1).max(10)).max(50).default([]),
    countCommands: z.boolean().default(true),
    resetOn: z.enum(["never", "leave", "ban", "both"]).default("never"),
    dailyTopRoleId: z.union([snowflake, z.null()]).default(null),
  }).default({}),
  channelPolicy: z.object({
    mode: z.enum(["denylist", "allowlist"]).default("denylist"),
    channelIds: z.array(snowflake).max(500).default([]),
    threadsEnabled: z.boolean().default(false),
  }).default({}),
  manualPermissions: z.boolean().default(false),
});

export type GuildSettings = z.infer<typeof guildSettingsSchema>;
export const defaultGuildSettings: GuildSettings = guildSettingsSchema.parse({});

export function parseGuildSettings(input: unknown): GuildSettings {
  const value = input && typeof input === "object" ? structuredClone(input as Record<string, unknown>) : {};
  const leaderboard = value.leaderboard as Record<string, unknown> | undefined;
  if (leaderboard?.private === true && leaderboard.visibility === undefined) leaderboard.visibility = "members";
  return guildSettingsSchema.parse(value);
}
