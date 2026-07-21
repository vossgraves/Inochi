import { and, desc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { defaultGuildSettings, parseGuildSettings } from "@inochi/core";
import type { Database } from "./client";
import { externalVotes, gameRounds, gameWinners, guilds, importEntries, importSessions, members, xpPeriods } from "./schema";

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
  const pageLimit = Math.min(100, limit, maximum - offset);
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
    .where(and(eq(importSessions.status, "collecting"), lt(importSessions.expiresAt, new Date())));
}

export async function applyImport(db: Database, sessionId: string) {
  return db.transaction(async (tx) => {
    const session = await tx.query.importSessions.findFirst({ where: and(eq(importSessions.id, sessionId), or(eq(importSessions.status, "review"), eq(importSessions.status, "collecting"))) });
    if (!session) throw new Error("Import session is not available");
    const entries = await tx.select().from(importEntries).where(eq(importEntries.sessionId, sessionId));
    for (const entry of entries) {
      await tx.insert(members).values({ guildId: session.guildId, userId: entry.userId, xp: entry.xp, weeklyXp: 0 })
        .onConflictDoUpdate({ target: [members.guildId, members.userId], set: { xp: entry.xp, updatedAt: new Date() } });
    }
    await tx.update(importSessions).set({ status: "completed", updatedAt: new Date() }).where(eq(importSessions.id, sessionId));
    return entries.length;
  });
}
