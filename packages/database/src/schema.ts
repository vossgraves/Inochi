import { relations, sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { GuildSettings } from "@inochi/core";

export const importStatus = pgEnum("import_status", ["collecting", "review", "completed", "cancelled", "expired"]);
export const importSource = pgEnum("import_source", ["json", "csv", "mee6", "arcane", "probot", "lurkr", "amari", "tatsu", "carlbot"]);
export const gameType = pgEnum("game_type", ["word", "math"]);
export const backupTrigger = pgEnum("backup_trigger", ["manual", "pre_restore", "scheduled"]);
export const coinflipSide = pgEnum("coinflip_side", ["heads", "tails"]);
export const coinflipStatus = pgEnum("coinflip_status", ["pending", "completed", "declined", "expired"]);

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name"),
  icon: text("icon"),
  settings: jsonb("settings").$type<GuildSettings>().notNull(),
  settingsRevision: integer("settings_revision").default(1).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  leftAt: timestamp("left_at", { withTimezone: true }),
  welcomeSentAt: timestamp("welcome_sent_at", { withTimezone: true }),
  welcomeChannelId: text("welcome_channel_id"),
  welcomeMessageId: text("welcome_message_id"),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  setupVersion: integer("setup_version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const members = pgTable("members", {
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  xp: bigint("xp", { mode: "number" }).default(0).notNull(),
  weeklyXp: bigint("weekly_xp", { mode: "number" }).default(0).notNull(),
  messageCount: bigint("message_count", { mode: "number" }).default(0).notNull(),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  hidden: boolean("hidden").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId] }),
  index("members_leaderboard_idx").on(table.guildId, table.xp),
]);

export const oauthSessions = pgTable("oauth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gameRounds = pgTable("game_rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  type: gameType("type").notNull(),
  answer: text("answer").notNull(),
  prompt: jsonb("prompt").$type<Record<string, unknown>>().default({}).notNull(),
  placeXp: jsonb("place_xp").$type<number[]>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("game_rounds_active_idx").on(table.guildId, table.channelId, table.expiresAt)]);

export const gameWinners = pgTable("game_winners", {
  roundId: uuid("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  place: integer("place").notNull(),
  xpReward: integer("xp_reward").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.roundId, table.userId] }),
  uniqueIndex("game_winners_place_idx").on(table.roundId, table.place),
]);

export const coinflipChallenges = pgTable("coinflip_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  interactionKey: text("interaction_key").notNull().unique(),
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  challengerId: text("challenger_id").notNull(),
  opponentId: text("opponent_id").notNull(),
  wager: bigint("wager", { mode: "number" }).notNull(),
  challengerSide: coinflipSide("challenger_side").notNull(),
  outcome: coinflipSide("outcome"),
  winnerId: text("winner_id"),
  status: coinflipStatus("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("coinflip_challenges_due_idx").on(table.status, table.expiresAt),
  index("coinflip_challenges_guild_created_idx").on(table.guildId, table.createdAt),
  index("coinflip_challenges_challenger_idx").on(table.guildId, table.challengerId, table.createdAt),
  index("coinflip_challenges_opponent_idx").on(table.guildId, table.opponentId, table.createdAt),
  check("coinflip_challenges_distinct_members_check", sql`${table.challengerId} <> ${table.opponentId}`),
  check("coinflip_challenges_positive_wager_check", sql`${table.wager} > 0`),
  check("coinflip_challenges_winner_check", sql`${table.winnerId} is null or ${table.winnerId} in (${table.challengerId}, ${table.opponentId})`),
  check("coinflip_challenges_resolution_check", sql`(${table.status} = 'pending' and ${table.outcome} is null and ${table.winnerId} is null and ${table.resolvedAt} is null) or (${table.status} = 'completed' and ${table.outcome} is not null and ${table.winnerId} is not null and ${table.resolvedAt} is not null) or (${table.status} in ('declined', 'expired') and ${table.outcome} is null and ${table.winnerId} is null and ${table.resolvedAt} is not null)`),
]);

export const gameSchedules = pgTable("game_schedules", {
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  rotationIndex: integer("rotation_index").default(0).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.channelId] }), index("game_schedules_due_idx").on(table.nextRunAt)]);

export const externalVotes = pgTable("external_votes", {
  provider: text("provider").notNull(),
  userId: text("user_id").notNull(),
  votedAt: timestamp("voted_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  test: boolean("test").default(false).notNull(),
}, (table) => [primaryKey({ columns: [table.provider, table.userId] }), index("external_votes_active_idx").on(table.userId, table.expiresAt)]);

export const xpPeriods = pgTable("xp_periods", {
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  period: text("period").notNull(),
  xp: bigint("xp", { mode: "number" }).default(0).notNull(),
  messages: bigint("messages", { mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.userId, table.period] }), index("xp_periods_period_idx").on(table.period, table.guildId)]);

export const rankProfiles = pgTable("rank_profiles", {
  userId: text("user_id").primaryKey(),
  colorMode: text("color_mode").default("monochrome").notNull(),
  color: text("color"),
  backgroundKey: text("background_key"),
  leaderboardPrivate: boolean("leaderboard_private").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const backupSnapshots = pgTable("backup_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  trigger: backupTrigger("trigger").notNull(),
  formatVersion: integer("format_version").default(1).notNull(),
  checksum: text("checksum").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveryError: text("delivery_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("backup_snapshots_guild_idx").on(table.guildId, table.createdAt)]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  writeAccess: boolean("write_access").default(false).notNull(),
  guildIds: jsonb("guild_ids").$type<string[]>().default([]).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const importSessions = pgTable("import_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  source: importSource("source").notNull(),
  strategy: text("strategy"),
  sourceBotId: text("source_bot_id"),
  status: importStatus("status").default("collecting").notNull(),
  channelId: text("channel_id"),
  sourceMessageId: text("source_message_id"),
  rawSnapshot: jsonb("raw_snapshot").$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
  capturedPages: jsonb("captured_pages").$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
  warnings: jsonb("warnings").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  recognizedMessages: integer("recognized_messages").default(0).notNull(),
  lastError: text("last_error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("import_sessions_active_lookup_idx").on(table.guildId, table.channelId, table.sourceBotId, table.status, table.expiresAt),
]);

export const importEntries = pgTable("import_entries", {
  sessionId: uuid("session_id").notNull().references(() => importSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  xp: bigint("xp", { mode: "number" }).notNull(),
  level: integer("level"),
  exact: boolean("exact").default(true).notNull(),
  metric: text("metric").default("xp").notNull(),
  sourcePage: integer("source_page"),
}, (table) => [primaryKey({ columns: [table.sessionId, table.userId] })]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  guildId: text("guild_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_logs_guild_idx").on(table.guildId, table.createdAt)]);

export const guildRelations = relations(guilds, ({ many }) => ({ members: many(members), imports: many(importSessions) }));
export const memberRelations = relations(members, ({ one }) => ({ guild: one(guilds, { fields: [members.guildId], references: [guilds.id] }) }));
