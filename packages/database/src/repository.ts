import { and, desc, eq, gt, gte, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import { applyLevelingPreset, defaultGuildSettings, MAX_COINFLIP_WAGER, parseGuildSettings } from "@inochi/core";
import type { GuildSettings, LevelingBackup, LevelingPresetName } from "@inochi/core";
import type { Database } from "./client";
import { auditLogs, backupSnapshots, coinflipChallenges, externalVotes, gameRounds, gameWinners, guilds, importCapturedMessages, importEntries, importSessions, members, persistentLeaderboards, xpPeriods } from "./schema";
import type { ImportExpectedPages, ImportPreviewSummary, ImportSettingsKey, ImportXpApplyMode, PersistedImportApplyResult } from "./schema";

function periodKeys(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return [day, day.slice(0, 7)];
}

async function recordXpPeriods(db: Pick<Database, "insert">, guildId: string, userId: string, xp: number, messages: number) {
  for (const period of periodKeys()) {
    await db.insert(xpPeriods).values({ guildId, userId, period, xp, messages }).onConflictDoUpdate({
      target: [xpPeriods.guildId, xpPeriods.userId, xpPeriods.period],
      set: { xp: sql`${xpPeriods.xp} + ${xp}`, messages: sql`${xpPeriods.messages} + ${messages}` },
    });
  }
}

export async function getOrCreateGuild(db: Database, guildId: string, name?: string) {
  const [guild] = await db.insert(guilds).values({ id: guildId, name, settings: defaultGuildSettings })
    .onConflictDoUpdate({ target: guilds.id, set: { name, updatedAt: new Date() } }).returning();
  if (!guild) throw new Error("Failed to load guild");
  return { ...guild, settings: parseGuildSettings(guild.settings) };
}

export async function getGuild(db: Database, guildId: string) {
  const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
  return guild ? { ...guild, settings: parseGuildSettings(guild.settings) } : null;
}

export async function awardXp(db: Pick<Database, "insert">, input: { guildId: string; userId: string; amount: number; cooldownUntil?: Date; countMessage?: boolean; weekly?: boolean }) {
  const amount = Math.max(0, Math.floor(input.amount));
  const weeklyAmount = input.weekly === false ? 0 : amount;
  const [member] = await db.insert(members).values({
    guildId: input.guildId,
    userId: input.userId,
    xp: amount,
    weeklyXp: weeklyAmount,
    messageCount: input.countMessage ? 1 : 0,
    cooldownUntil: input.cooldownUntil,
  }).onConflictDoUpdate({
    target: [members.guildId, members.userId],
    set: {
      xp: sql`${members.xp} + ${amount}`,
      weeklyXp: sql`${members.weeklyXp} + ${weeklyAmount}`,
      messageCount: input.countMessage ? sql`${members.messageCount} + 1` : members.messageCount,
      cooldownUntil: input.cooldownUntil,
      hidden: false,
      updatedAt: new Date(),
    },
  }).returning();
  if (!member) throw new Error("Failed to award XP");
  await recordXpPeriods(db, input.guildId, input.userId, amount, input.countMessage ? 1 : 0);
  return member;
}

export async function claimMessageXp(db: Database, input: { guildId: string; userId: string; amount: number; cooldownUntil: Date; weekly?: boolean }) {
  const amount = Math.max(0, Math.floor(input.amount));
  const weeklyAmount = input.weekly === false ? 0 : amount;
  const [member] = await db.insert(members).values({
    guildId: input.guildId, userId: input.userId, xp: amount, weeklyXp: weeklyAmount,
    messageCount: 1, cooldownUntil: input.cooldownUntil,
  }).onConflictDoUpdate({
    target: [members.guildId, members.userId],
    set: {
      xp: sql`${members.xp} + ${amount}`,
      weeklyXp: sql`${members.weeklyXp} + ${weeklyAmount}`,
      messageCount: sql`${members.messageCount} + 1`,
      cooldownUntil: input.cooldownUntil,
      hidden: false,
      updatedAt: new Date(),
    },
    setWhere: or(isNull(members.cooldownUntil), lt(members.cooldownUntil, new Date())),
  }).returning();
  if (member) await recordXpPeriods(db, input.guildId, input.userId, amount, 1);
  return member ?? null;
}

export async function getLeaderboard(db: Database, guildId: string, limit = 10, offset = 0, options: { minimumXp?: number; maximumEntries?: number } = {}) {
  const maximum = options.maximumEntries && options.maximumEntries > 0 ? options.maximumEntries : Number.MAX_SAFE_INTEGER;
  if (offset >= maximum) return [];
  const pageLimit = Math.min(101, limit, maximum - offset);
  const xpCondition = options.minimumXp && options.minimumXp > 0 ? gte(members.xp, options.minimumXp) : gt(members.xp, 0);
  return db.select().from(members).where(and(eq(members.guildId, guildId), eq(members.hidden, false), xpCondition))
    .orderBy(desc(members.xp), members.userId).limit(pageLimit).offset(Math.max(0, offset));
}

export async function getRank(db: Database, guildId: string, userId: string) {
  const member = await db.query.members.findFirst({ where: and(eq(members.guildId, guildId), eq(members.userId, userId)) });
  if (!member) return null;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(members)
    .where(and(eq(members.guildId, guildId), eq(members.hidden, false), gt(members.xp, member.xp)));
  return { ...member, rank: (row?.count ?? 0) + 1 };
}

const LEADERBOARD_COALESCE_MS = 5_000;

export async function configurePersistentLeaderboard(db: Pick<Database, "insert">, input: { guildId: string; channelId: string; dueAt?: Date }) {
  const now = new Date();
  const dueAt = input.dueAt ?? now;
  const [row] = await db.insert(persistentLeaderboards).values({ guildId: input.guildId, channelId: input.channelId, dueAt })
    .onConflictDoUpdate({
      target: persistentLeaderboards.guildId,
      set: {
        channelId: sql`case when ${persistentLeaderboards.channelId} = ${input.channelId} or ${persistentLeaderboards.messageId} is null then ${input.channelId} else ${persistentLeaderboards.channelId} end`,
        enabled: sql`${persistentLeaderboards.channelId} = ${input.channelId} or ${persistentLeaderboards.messageId} is null`,
        contentHash: sql`case when ${persistentLeaderboards.channelId} = ${input.channelId} then ${persistentLeaderboards.contentHash} else null end`,
        dirty: true,
        dueAt,
        leaseUntil: null,
        updatedAt: now,
      },
    }).returning();
  if (!row) throw new Error("Failed to configure persistent leaderboard");
  return row;
}

export async function disablePersistentLeaderboard(db: Pick<Database, "update">, guildId: string) {
  const now = new Date();
  const [row] = await db.update(persistentLeaderboards).set({ enabled: false, dirty: true, dueAt: now, leaseUntil: null, updatedAt: now })
    .where(eq(persistentLeaderboards.guildId, guildId)).returning();
  return row ?? null;
}

export async function getPersistentLeaderboardStatus(db: Database, guildId: string) {
  return (await db.query.persistentLeaderboards.findFirst({ where: eq(persistentLeaderboards.guildId, guildId) })) ?? null;
}

export async function markPersistentLeaderboardDirty(db: Pick<Database, "update">, guildId: string, options: { now?: Date; coalesceMs?: number } = {}) {
  const now = options.now ?? new Date();
  const dueAt = new Date(now.getTime() + (options.coalesceMs ?? LEADERBOARD_COALESCE_MS));
  const nowIso = now.toISOString();
  const dueAtIso = dueAt.toISOString();
  const [row] = await db.update(persistentLeaderboards).set({
    dirty: true,
    dueAt: sql`case
      when ${persistentLeaderboards.leaseUntil} > ${nowIso}::timestamptz then ${dueAtIso}::timestamptz
      when ${persistentLeaderboards.dirty} then least(${persistentLeaderboards.dueAt}, ${dueAtIso}::timestamptz)
      else ${dueAtIso}::timestamptz
    end`,
    updatedAt: now,
  }).where(eq(persistentLeaderboards.guildId, guildId)).returning();
  return row ?? null;
}

export async function markPersistentLeaderboardsForUserDirty(db: Pick<Database, "update">, userId: string, options: { now?: Date; coalesceMs?: number } = {}) {
  const now = options.now ?? new Date();
  const dueAt = new Date(now.getTime() + (options.coalesceMs ?? LEADERBOARD_COALESCE_MS));
  const nowIso = now.toISOString();
  const dueAtIso = dueAt.toISOString();
  return db.update(persistentLeaderboards).set({
    dirty: true,
    dueAt: sql`case
      when ${persistentLeaderboards.leaseUntil} > ${nowIso}::timestamptz then ${dueAtIso}::timestamptz
      when ${persistentLeaderboards.dirty} then least(${persistentLeaderboards.dueAt}, ${dueAtIso}::timestamptz)
      else ${dueAtIso}::timestamptz
    end`,
    updatedAt: now,
  }).where(sql`${persistentLeaderboards.guildId} in (select ${members.guildId} from ${members} where ${members.userId} = ${userId})`).returning();
}

export interface PersistentLeaderboardClaim {
  guildId: string;
  channelId: string;
  messageId: string | null;
  enabled: boolean;
  contentHash: string | null;
  failureCount: number;
  dueAt: Date;
  leaseUntil: Date;
}

export async function claimDuePersistentLeaderboards(db: Database, options: { now?: Date; leaseMs?: number; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseMs ?? 60_000));
  const candidates = await db.select({ guildId: persistentLeaderboards.guildId }).from(persistentLeaderboards)
    .where(and(eq(persistentLeaderboards.dirty, true), lte(persistentLeaderboards.dueAt, now), or(isNull(persistentLeaderboards.leaseUntil), lt(persistentLeaderboards.leaseUntil, now))))
    .orderBy(persistentLeaderboards.dueAt).limit(Math.max(1, Math.min(options.limit ?? 25, 100)));
  const claims: PersistentLeaderboardClaim[] = [];
  for (const candidate of candidates) {
    const [row] = await db.update(persistentLeaderboards).set({ leaseUntil, updatedAt: now }).where(and(
      eq(persistentLeaderboards.guildId, candidate.guildId),
      eq(persistentLeaderboards.dirty, true),
      lte(persistentLeaderboards.dueAt, now),
      or(isNull(persistentLeaderboards.leaseUntil), lt(persistentLeaderboards.leaseUntil, now)),
    )).returning();
    if (row) claims.push({ guildId: row.guildId, channelId: row.channelId, messageId: row.messageId, enabled: row.enabled, contentHash: row.contentHash, failureCount: row.failureCount, dueAt: row.dueAt, leaseUntil: row.leaseUntil! });
  }
  return claims;
}

export async function completePersistentLeaderboard(db: Database, claim: PersistentLeaderboardClaim, input: { channelId: string; messageId: string; contentHash: string; renderedAt?: Date }) {
  const renderedAt = input.renderedAt ?? new Date();
  const [row] = await db.update(persistentLeaderboards).set({
    channelId: input.channelId,
    messageId: input.messageId,
    contentHash: input.contentHash,
    dirty: sql`${persistentLeaderboards.dueAt} > ${claim.dueAt}`,
    leaseUntil: null,
    lastRenderedAt: renderedAt,
    failureCount: 0,
    lastError: null,
    lastFailedAt: null,
    updatedAt: renderedAt,
  }).where(and(eq(persistentLeaderboards.guildId, claim.guildId), eq(persistentLeaderboards.leaseUntil, claim.leaseUntil))).returning();
  return row ?? null;
}

export async function failPersistentLeaderboard(db: Database, claim: PersistentLeaderboardClaim, error: unknown, options: { now?: Date; retryAt?: Date } = {}) {
  const now = options.now ?? new Date();
  const retryAt = options.retryAt ?? new Date(now.getTime() + Math.min(300_000, 5_000 * 2 ** Math.min(claim.failureCount, 6)));
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  const [row] = await db.update(persistentLeaderboards).set({ dirty: true, dueAt: retryAt, leaseUntil: null, failureCount: sql`${persistentLeaderboards.failureCount} + 1`, lastError: message, lastFailedAt: now, updatedAt: now })
    .where(and(eq(persistentLeaderboards.guildId, claim.guildId), eq(persistentLeaderboards.leaseUntil, claim.leaseUntil))).returning();
  return row ?? null;
}

export async function completeDisabledPersistentLeaderboard(db: Database, claim: PersistentLeaderboardClaim) {
  const [row] = await db.delete(persistentLeaderboards).where(and(
    eq(persistentLeaderboards.guildId, claim.guildId),
    eq(persistentLeaderboards.enabled, false),
    eq(persistentLeaderboards.leaseUntil, claim.leaseUntil),
  )).returning();
  return row ?? null;
}

export async function retryPersistentLeaderboard(db: Pick<Database, "update">, guildId: string, now = new Date()) {
  const [row] = await db.update(persistentLeaderboards).set({ dirty: true, dueAt: now, leaseUntil: null, lastError: null, updatedAt: now })
    .where(eq(persistentLeaderboards.guildId, guildId)).returning();
  return row ?? null;
}

export async function findActiveGameRound(db: Database, guildId: string, channelId: string) {
  return db.query.gameRounds.findFirst({
    where: and(eq(gameRounds.guildId, guildId), eq(gameRounds.channelId, channelId), isNull(gameRounds.completedAt), gt(gameRounds.expiresAt, new Date())),
  });
}

export async function createGameRound(db: Database, input: { guildId: string; channelId: string; type: "word" | "math"; answer: string; prompt: Record<string, unknown>; placeXp: number[]; expiresAt: Date }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.guildId}:${input.channelId}:game`}))`);
    const active = await tx.query.gameRounds.findFirst({ where: and(eq(gameRounds.guildId, input.guildId), eq(gameRounds.channelId, input.channelId), isNull(gameRounds.completedAt), gt(gameRounds.expiresAt, new Date())) });
    if (active) throw new Error("A game round is already active in this channel");
    await tx.update(gameRounds).set({ completedAt: new Date() }).where(and(eq(gameRounds.guildId, input.guildId), eq(gameRounds.channelId, input.channelId), isNull(gameRounds.completedAt)));
    const [round] = await tx.insert(gameRounds).values({ ...input, placeXp: input.placeXp.slice(0, 3) }).returning();
    if (!round) throw new Error("Could not create game round");
    return round;
  });
}

export async function claimGameWinner(db: Database, input: { roundId: string; userId: string; weekly: boolean }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.roundId}))`);
    const round = await tx.query.gameRounds.findFirst({ where: and(eq(gameRounds.id, input.roundId), isNull(gameRounds.completedAt), gt(gameRounds.expiresAt, new Date())) });
    if (!round) return null;
    const prior = await tx.query.gameWinners.findFirst({ where: and(eq(gameWinners.roundId, round.id), eq(gameWinners.userId, input.userId)) });
    if (prior) return null;
    const winners = await tx.select().from(gameWinners).where(eq(gameWinners.roundId, round.id));
    const place = winners.length + 1;
    const xpReward = round.placeXp[place - 1];
    if (xpReward === undefined) return null;
    await tx.insert(gameWinners).values({ roundId: round.id, userId: input.userId, place, xpReward });
    const member = await awardXp(tx, { guildId: round.guildId, userId: input.userId, amount: xpReward, weekly: input.weekly });
    if (place >= round.placeXp.length) await tx.update(gameRounds).set({ completedAt: new Date() }).where(eq(gameRounds.id, round.id));
    return { round, place, xpReward, member, complete: place >= round.placeXp.length };
  });
}

export type CoinflipSide = "heads" | "tails";

export interface CreateCoinflipChallengeInput {
  interactionKey: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  challengerId: string;
  opponentId: string;
  wager: number;
  challengerSide: CoinflipSide;
  expiresAt: Date;
}

function validateCoinflipWager(wager: number) {
  if (!Number.isSafeInteger(wager) || wager <= 0 || wager > MAX_COINFLIP_WAGER) {
    throw new Error("Coinflip wager must be a positive safe integer");
  }
}

export async function createCoinflipChallenge(db: Database, input: CreateCoinflipChallengeInput) {
  validateCoinflipWager(input.wager);
  if (input.challengerId === input.opponentId) throw new Error("You cannot challenge yourself");
  if (input.expiresAt.getTime() <= Date.now()) throw new Error("Coinflip challenge expiry must be in the future");

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.interactionKey}))`);
    const existing = await tx.query.coinflipChallenges.findFirst({ where: eq(coinflipChallenges.interactionKey, input.interactionKey) });
    if (existing) {
      const matches = existing.guildId === input.guildId && existing.channelId === input.channelId
        && existing.challengerId === input.challengerId && existing.opponentId === input.opponentId
        && existing.wager === input.wager && existing.challengerSide === input.challengerSide;
      if (!matches) throw new Error("Coinflip idempotency key was reused with different challenge data");
      return existing;
    }
    await tx.execute(sql`select id from guilds where id = ${input.guildId} for share`);
    const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, input.guildId) });
    if (!guild) throw new Error("Guild not found");
    const settings = parseGuildSettings(guild.settings);
    if (!settings.enabled) throw new Error("XP is disabled in this server");
    if (!settings.games.coinflip.enabled) throw new Error("Coinflip is disabled in this server");
    if (input.wager < settings.games.coinflip.minWager || input.wager > settings.games.coinflip.maxWager) throw new Error("Coinflip wager is outside this server's configured limits");
    const challenger = await tx.query.members.findFirst({
      where: and(eq(members.guildId, input.guildId), eq(members.userId, input.challengerId), gte(members.xp, input.wager)),
    });
    if (!challenger) throw new Error("Challenger has insufficient XP for this wager");
    const [challenge] = await tx.insert(coinflipChallenges).values(input).returning();
    if (!challenge) throw new Error("Could not create coinflip challenge");
    return challenge;
  });
}

export interface AcceptCoinflipChallengeInput {
  challengeId: string;
  opponentId: string;
  guildId: string;
  channelId: string;
}

export async function acceptCoinflipChallenge(
  db: Database,
  input: AcceptCoinflipChallengeInput,
  drawSide: () => CoinflipSide = () => randomInt(2) === 0 ? "heads" : "tails",
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.challengeId}))`);
    let challenge = await tx.query.coinflipChallenges.findFirst({ where: eq(coinflipChallenges.id, input.challengeId) });
    if (!challenge) throw new Error("Coinflip challenge not found");
    if (challenge.guildId !== input.guildId || challenge.channelId !== input.channelId) throw new Error("This coinflip belongs to another channel");
    if (challenge.opponentId !== input.opponentId) throw new Error("Only the challenged opponent can accept this coinflip");
    if (challenge.status === "completed") return { challenge, idempotent: true };
    if (challenge.status !== "pending") throw new Error(`Coinflip challenge is ${challenge.status}`);
    const resolvedAt = new Date();
    if (challenge.expiresAt <= resolvedAt) {
      const [expired] = await tx.update(coinflipChallenges).set({ status: "expired", resolvedAt })
        .where(and(eq(coinflipChallenges.id, challenge.id), eq(coinflipChallenges.status, "pending"))).returning();
      if (!expired) throw new Error("Coinflip challenge is no longer pending");
      return { challenge: expired, idempotent: false };
    }
    validateCoinflipWager(challenge.wager);
    await tx.execute(sql`select id from guilds where id = ${challenge.guildId} for share`);
    const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, challenge.guildId) });
    if (!guild) throw new Error("Guild not found");
    const settings = parseGuildSettings(guild.settings);
    if (!settings.enabled) throw new Error("XP is disabled in this server");
    if (!settings.games.coinflip.enabled) throw new Error("Coinflip is disabled in this server");
    if (challenge.wager < settings.games.coinflip.minWager || challenge.wager > settings.games.coinflip.maxWager) throw new Error("Coinflip wager is outside this server's configured limits");

    await tx.execute(sql`select user_id from members where guild_id = ${challenge.guildId} and user_id in (${challenge.challengerId}, ${challenge.opponentId}) order by user_id for update`);
    const [challenger] = await tx.update(members).set({ xp: sql`${members.xp} - ${challenge.wager}`, updatedAt: resolvedAt })
      .where(and(eq(members.guildId, challenge.guildId), eq(members.userId, challenge.challengerId), gte(members.xp, challenge.wager), lte(members.xp, Number.MAX_SAFE_INTEGER - challenge.wager))).returning();
    if (!challenger) throw new Error("Challenger has insufficient XP for this wager");
    const [opponent] = await tx.update(members).set({ xp: sql`${members.xp} - ${challenge.wager}`, updatedAt: resolvedAt })
      .where(and(eq(members.guildId, challenge.guildId), eq(members.userId, challenge.opponentId), gte(members.xp, challenge.wager), lte(members.xp, Number.MAX_SAFE_INTEGER - challenge.wager))).returning();
    if (!opponent) throw new Error("Opponent has insufficient XP for this wager");

    const outcome = drawSide();
    if (outcome !== "heads" && outcome !== "tails") throw new Error("Coinflip outcome source returned an invalid side");
    const winnerId = outcome === challenge.challengerSide ? challenge.challengerId : challenge.opponentId;
    const [winner] = await tx.update(members).set({ xp: sql`${members.xp} + ${challenge.wager * 2}`, updatedAt: resolvedAt })
      .where(and(eq(members.guildId, challenge.guildId), eq(members.userId, winnerId))).returning();
    if (!winner) throw new Error("Could not credit coinflip winner");
    const [completed] = await tx.update(coinflipChallenges).set({ status: "completed", outcome, winnerId, resolvedAt })
      .where(and(eq(coinflipChallenges.id, challenge.id), eq(coinflipChallenges.status, "pending"))).returning();
    if (!completed) throw new Error("Coinflip challenge was resolved concurrently");
    challenge = completed;
    return { challenge, winner, idempotent: false };
  });
}

export async function declineCoinflipChallenge(db: Database, input: { challengeId: string; opponentId: string; guildId: string; channelId: string }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.challengeId}))`);
    const challenge = await tx.query.coinflipChallenges.findFirst({ where: eq(coinflipChallenges.id, input.challengeId) });
    if (!challenge) throw new Error("Coinflip challenge not found");
    if (challenge.guildId !== input.guildId || challenge.channelId !== input.channelId) throw new Error("This coinflip belongs to another channel");
    if (challenge.opponentId !== input.opponentId) throw new Error("Only the challenged opponent can decline this coinflip");
    if (challenge.status === "declined") return challenge;
    if (challenge.status !== "pending") throw new Error(`Coinflip challenge is ${challenge.status}`);
    const resolvedAt = new Date();
    const status = challenge.expiresAt <= resolvedAt ? "expired" : "declined";
    const [resolved] = await tx.update(coinflipChallenges).set({ status, resolvedAt })
      .where(and(eq(coinflipChallenges.id, challenge.id), eq(coinflipChallenges.status, "pending"))).returning();
    if (!resolved) throw new Error("Coinflip challenge was resolved concurrently");
    return resolved;
  });
}

export async function expireCoinflipChallenges(db: Database, now = new Date()) {
  return db.update(coinflipChallenges).set({ status: "expired", resolvedAt: now })
    .where(and(eq(coinflipChallenges.status, "pending"), lte(coinflipChallenges.expiresAt, now))).returning();
}

export async function registerVote(db: Database, input: { userId: string; durationHours: number; test?: boolean }) {
  const votedAt = new Date();
  const expiresAt = new Date(votedAt.getTime() + input.durationHours * 3_600_000);
  const [vote] = await db.insert(externalVotes).values({ provider: "topgg", userId: input.userId, votedAt, expiresAt, test: input.test ?? false })
    .onConflictDoUpdate({ target: [externalVotes.provider, externalVotes.userId], set: { votedAt, expiresAt, test: input.test ?? false } }).returning();
  return vote;
}

export async function activeVote(db: Database, userId: string) {
  return db.query.externalVotes.findFirst({ where: and(eq(externalVotes.provider, "topgg"), eq(externalVotes.userId, userId), gt(externalVotes.expiresAt, new Date())) });
}

export async function expireImports(db: Database) {
  await db.update(importSessions).set({ status: "expired", updatedAt: new Date() })
    .where(and(or(eq(importSessions.status, "collecting"), eq(importSessions.status, "review")), lt(importSessions.expiresAt, new Date())));
}

export interface ImportApplyResult extends PersistedImportApplyResult {
  idempotent: boolean;
  changedUserIds: string[];
  toLocaleString(): string;
}

export async function prepareImportSession(db: Database, input: {
  sessionId: string;
  formatVersion?: number;
  preset?: LevelingPresetName | null;
  settingsProposal?: Partial<GuildSettings> | null;
  selectedSettings?: ImportSettingsKey[];
  xpApplyMode?: ImportXpApplyMode;
  previewSummary?: ImportPreviewSummary;
  expectedPages?: ImportExpectedPages | null;
  allowApproximate?: boolean;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sessionId}))`);
    await tx.execute(sql`select id from import_sessions where id = ${input.sessionId} for update`);
    const session = await tx.query.importSessions.findFirst({ where: eq(importSessions.id, input.sessionId) });
    if (!session || (session.status !== "collecting" && session.status !== "review") || session.expiresAt <= now) {
      throw new Error("Import session is not available");
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${session.guildId}:import`}))`);
    await tx.execute(sql`select id from guilds where id = ${session.guildId} for share`);
    const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, session.guildId) });
    if (!guild) throw new Error("Import guild not found");
    const currentSettings = parseGuildSettings(guild.settings);
    const presetSettings = input.preset ? applyLevelingPreset(currentSettings, input.preset) : null;
    const generatedProposal = presetSettings ? { gain: presetSettings.gain, curve: presetSettings.curve, multipliers: presetSettings.multipliers } : input.preset === null ? null : undefined;
    const selectedSettings = [...new Set(input.selectedSettings ?? session.selectedSettings)];
    const proposal = generatedProposal === undefined ? input.settingsProposal === undefined ? session.settingsProposal : input.settingsProposal : generatedProposal;
    if (input.preset === undefined && input.settingsProposal === undefined && session.baselineSettingsRevision !== null && session.baselineSettingsRevision !== guild.settingsRevision) {
      throw new Error("Guild settings changed after the import preview was created; review the import again");
    }
    if (selectedSettings.some((key) => !(key in parseGuildSettings(guild.settings)))) throw new Error("Import selected an unknown settings section");
    if (selectedSettings.some((key) => !proposal || !(key in proposal))) throw new Error("Import selected a settings section without a proposal");
    const formatVersion = input.formatVersion ?? session.formatVersion;
    if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) throw new Error("Import format version must be a positive integer");
    const entries = await tx.select({ exact: importEntries.exact }).from(importEntries).where(eq(importEntries.sessionId, session.id));
    if (!entries.length) throw new Error("No leaderboard records have been captured yet");
    const approximate = entries.filter((entry) => !entry.exact).length;
    if (approximate > 0 && input.allowApproximate === false) throw new Error("This source exposed levels without exact XP, but no verified conversion preset is available");
    const previewSummary = { records: entries.length, exact: entries.length - approximate, approximate, invalid: 0, duplicate: 0 } satisfies ImportPreviewSummary;
    const replacesProposal = input.preset !== undefined || input.settingsProposal !== undefined;
    const [prepared] = await tx.update(importSessions).set({
      status: "review",
      formatVersion,
      baselineSettingsRevision: replacesProposal ? guild.settingsRevision : session.baselineSettingsRevision,
      settingsProposal: proposal,
      selectedSettings,
      xpApplyMode: input.xpApplyMode ?? session.xpApplyMode,
      previewSummary: input.previewSummary ?? previewSummary,
      expectedPages: input.expectedPages === undefined ? session.expectedPages : input.expectedPages,
      updatedAt: now,
    }).where(and(eq(importSessions.id, session.id), or(eq(importSessions.status, "collecting"), eq(importSessions.status, "review")))).returning();
    if (!prepared) throw new Error("Import session changed while preparing its review");
    return prepared;
  });
}

function importApplyResult(result: PersistedImportApplyResult, idempotent: boolean, changedUserIds: string[] = []): ImportApplyResult {
  return { ...result, idempotent, changedUserIds, toLocaleString: () => result.applied.toLocaleString() };
}

export async function recordImportCapturedMessage(db: Database, input: {
  sessionId: string;
  messageId: string;
  snapshot: unknown;
  records?: Array<{ userId: string; xp: number; level?: number; exact: boolean; metric: string; page?: number }>;
  sourcePage?: number;
  capturedAt?: Date;
}) {
  const now = input.capturedAt ?? new Date();
  const serialized = JSON.stringify(input.snapshot);
  if (serialized === undefined) throw new Error("Captured import message must be JSON serializable");
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sessionId}))`);
    await tx.execute(sql`select id from import_sessions where id = ${input.sessionId} for update`);
    const session = await tx.query.importSessions.findFirst({ where: eq(importSessions.id, input.sessionId) });
    if (!session) throw new Error("Import session not found");
    const existing = await tx.query.importCapturedMessages.findFirst({
      where: and(eq(importCapturedMessages.sessionId, input.sessionId), eq(importCapturedMessages.messageId, input.messageId)),
    });
    if (existing?.contentHash === contentHash) return { message: existing, changed: false };
    if (session.status !== "collecting" || session.expiresAt <= now) throw new Error("Import session is not collecting messages");
    const [captured] = await tx.insert(importCapturedMessages).values({
      sessionId: input.sessionId,
      messageId: input.messageId,
      snapshot: input.snapshot,
      records: input.records ?? [],
      sourcePage: input.sourcePage,
      contentHash,
      capturedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [importCapturedMessages.sessionId, importCapturedMessages.messageId],
      set: {
        snapshot: input.snapshot,
        records: input.records ?? [],
        sourcePage: input.sourcePage,
        contentHash,
        revision: sql`${importCapturedMessages.revision} + 1`,
        capturedAt: now,
        updatedAt: now,
      },
      setWhere: ne(importCapturedMessages.contentHash, contentHash),
    }).returning();
    if (captured) return { message: captured, changed: true };
    throw new Error("Could not record captured import message");
  });
}

export async function applyImport(db: Database, input: { sessionId: string; actorId: string; approximateXp?: (level: number) => number; includeUser?: (userId: string) => boolean }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sessionId}))`);
    await tx.execute(sql`select id from import_sessions where id = ${input.sessionId} for update`);
    const session = await tx.query.importSessions.findFirst({ where: eq(importSessions.id, input.sessionId) });
    if (!session) throw new Error("Import session not found");
    if (session.status === "completed" && session.applyResult) return importApplyResult(session.applyResult, true);
    const completedAt = new Date();
    if (session.status !== "review" || session.expiresAt <= completedAt) throw new Error("Import session is not available");

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${session.guildId}:import`}))`);
    await tx.execute(sql`select id from guilds where id = ${session.guildId} for update`);
    const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, session.guildId) });
    if (!guild) throw new Error("Import guild not found");

    const selectedSettings = [...new Set(session.selectedSettings)];
    const currentSettings = parseGuildSettings(guild.settings);
    if (session.baselineSettingsRevision !== null && session.baselineSettingsRevision !== guild.settingsRevision) {
      throw new Error("Guild settings changed after the import preview was created; review the import again");
    }
    let nextSettings: GuildSettings = currentSettings;
    if (selectedSettings.length) {
      if (session.baselineSettingsRevision === null) throw new Error("Import settings were not reviewed against the current guild settings");
      if (!session.settingsProposal) throw new Error("Selected import settings have no proposal");
      const knownSettings = new Set(Object.keys(currentSettings));
      const invalid = selectedSettings.find((key) => !knownSettings.has(key) || !(key in session.settingsProposal!));
      if (invalid) throw new Error(`Invalid or missing imported settings section: ${invalid}`);
      const proposal = session.settingsProposal as Partial<GuildSettings>;
      const selected = Object.fromEntries(selectedSettings.map((key) => [key, proposal[key]]));
      nextSettings = parseGuildSettings({ ...currentSettings, ...selected });
    }

    await tx.execute(sql`select user_id from members where guild_id = ${session.guildId} order by user_id for update`);
    const memberSnapshot = await tx.select().from(members).where(eq(members.guildId, session.guildId));
    const backup: LevelingBackup = {
      format: "inochi-leveling-backup",
      version: 1,
      createdAt: completedAt.toISOString(),
      guildId: session.guildId,
      settings: currentSettings,
      members: memberSnapshot.map((member) => ({
        userId: member.userId,
        xp: member.xp,
        weeklyXp: member.weeklyXp,
        messageCount: member.messageCount,
        cooldownUntil: member.cooldownUntil?.toISOString() ?? null,
        hidden: member.hidden,
      })),
    };
    const checksum = createHash("sha256").update(JSON.stringify(backup)).digest("hex");
    const [safetyBackup] = await tx.insert(backupSnapshots).values({
      guildId: session.guildId,
      createdBy: input.actorId,
      trigger: "pre_import",
      checksum,
      payload: backup,
    }).returning();
    if (!safetyBackup) throw new Error("Could not create pre-import safety backup");

    let settingsRevision = guild.settingsRevision;
    if (selectedSettings.length) {
      const [updatedGuild] = await tx.update(guilds).set({
        settings: nextSettings,
        settingsRevision: sql`${guilds.settingsRevision} + 1`,
        updatedAt: completedAt,
      }).where(and(eq(guilds.id, session.guildId), eq(guilds.settingsRevision, guild.settingsRevision))).returning({ settingsRevision: guilds.settingsRevision });
      if (!updatedGuild) throw new Error("Guild settings changed while applying the import");
      settingsRevision = updatedGuild.settingsRevision;
      const persistent = nextSettings.leaderboard.persistent;
      if (nextSettings.enabled && nextSettings.leaderboard.enabled && persistent.enabled && persistent.channelId) {
        await configurePersistentLeaderboard(tx, { guildId: session.guildId, channelId: persistent.channelId, dueAt: completedAt });
      } else {
        await disablePersistentLeaderboard(tx, session.guildId);
      }
    }

    const entries = await tx.select().from(importEntries).where(eq(importEntries.sessionId, input.sessionId));
    const eligible = entries.filter((entry) => !input.includeUser || input.includeUser(entry.userId)).map((entry) => {
      const xp = Math.max(0, Math.floor(!entry.exact && entry.level !== null && input.approximateXp ? input.approximateXp(entry.level) : entry.xp));
      if (!Number.isSafeInteger(xp)) throw new Error(`Imported XP is outside the safe integer range for user ${entry.userId}`);
      return { guildId: session.guildId, userId: entry.userId, xp, weeklyXp: 0 };
    });
    let applied = 0;
    const changedUserIds: string[] = [];
    for (let offset = 0; offset < eligible.length; offset += 500) {
      const batch = eligible.slice(offset, offset + 500);
      if (!batch.length) continue;
      if (session.xpApplyMode === "missing") {
        const inserted = await tx.insert(members).values(batch).onConflictDoNothing({ target: [members.guildId, members.userId] }).returning({ userId: members.userId });
        applied += inserted.length;
        changedUserIds.push(...inserted.map((member) => member.userId));
      } else {
        const changed = await tx.insert(members).values(batch).onConflictDoUpdate({
          target: [members.guildId, members.userId],
          set: { xp: sql`excluded.xp`, updatedAt: completedAt },
          ...(session.xpApplyMode === "greater" ? { setWhere: lt(members.xp, sql`excluded.xp`) } : {}),
        }).returning({ userId: members.userId });
        applied += changed.length;
        changedUserIds.push(...changed.map((member) => member.userId));
      }
    }
    await markPersistentLeaderboardDirty(tx, session.guildId, { now: completedAt, coalesceMs: 0 });
    const result: PersistedImportApplyResult = {
      sessionId: session.id,
      guildId: session.guildId,
      xpMode: session.xpApplyMode,
      candidates: eligible.length,
      applied,
      skipped: eligible.length - applied,
      excluded: entries.length - eligible.length,
      settingsApplied: selectedSettings as ImportSettingsKey[],
      settingsRevision,
      backupId: safetyBackup.id,
      completedAt: completedAt.toISOString(),
    };
    await tx.insert(auditLogs).values({
      guildId: session.guildId,
      actorId: input.actorId,
      action: "xp.import",
      metadata: { source: session.source, strategy: session.strategy, sourceBotId: session.sourceBotId, formatVersion: session.formatVersion, ...result },
    });
    const [completed] = await tx.update(importSessions).set({
      status: "completed",
      safetyBackupId: safetyBackup.id,
      applyResult: result,
      completedAt,
      updatedAt: completedAt,
    }).where(and(eq(importSessions.id, session.id), eq(importSessions.status, "review"))).returning({ id: importSessions.id });
    if (!completed) throw new Error("Import session changed while it was being applied");
    return importApplyResult(result, false, changedUserIds);
  });
}
