import { AttachmentBuilder, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import {
  activeVote,
  and,
  claimGameWinner,
  createGameRound,
  db,
  eq,
  findActiveGameRound,
  gameRounds,
  gameSchedules,
  getOrCreateGuild,
  gt,
  isNull,
  lt,
  or,
  sql,
} from "@inochi/database";
import { renderMathGameImage, renderWordGameImage } from "@inochi/rank-card";
import { INOCHI_NAVY } from "./theme";

const words = ["nebula", "orbit", "meteor", "galaxy", "satellite", "comet", "eclipse", "cosmos", "pulsar", "gravity", "horizon", "spectrum", "velocity", "quantum"];

type Difficulty = "easy" | "medium" | "hard" | "mixed";

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateMathProblem(input: Difficulty) {
  const difficulty = input === "mixed" ? (["easy", "medium", "hard"] as const)[randomInt(0, 2)]! : input;
  if (difficulty === "easy") {
    const left = randomInt(2, 50);
    const right = randomInt(2, 50);
    const add = Math.random() > 0.45;
    return add ? { expression: `${left} + ${right}`, answer: left + right } : { expression: `${Math.max(left, right)} - ${Math.min(left, right)}`, answer: Math.abs(left - right) };
  }
  if (difficulty === "medium") {
    if (Math.random() > 0.35) {
      const left = randomInt(3, 16);
      const right = randomInt(3, 16);
      return { expression: `${left} × ${right}`, answer: left * right };
    }
    const answer = randomInt(3, 20);
    const divisor = randomInt(2, 12);
    return { expression: `${answer * divisor} ÷ ${divisor}`, answer };
  }
  const a = randomInt(3, 20);
  const b = randomInt(2, 12);
  const c = randomInt(2, 10);
  return Math.random() > 0.5
    ? { expression: `(${a} + ${b}) × ${c}`, answer: (a + b) * c }
    : { expression: `${a * c} - (${b} × ${c})`, answer: (a - b) * c };
}

function placeText(rewards: number[]) {
  return rewards.map((xp, index) => `**#${index + 1}** ${xp.toLocaleString()} XP`).join(" · ");
}

export async function startGame(channel: GuildTextBasedChannel, type: "word" | "math") {
  const me = channel.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  const required = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, channel.isThread() ? "Send Messages in Threads" : "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    [PermissionFlagsBits.AttachFiles, "Attach Files"],
  ] as const;
  const missing = required.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  if (missing.length) throw new Error(`Inochi needs ${missing.join(", ")} in this channel. Update its channel permissions or add it again from the Inochi website.`);

  const guild = await getOrCreateGuild(db, channel.guild.id, channel.guild.name);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  const config = type === "word" ? guild.settings.games.wordRace : guild.settings.games.mathRace;
  if (!config.enabled) throw new Error(`${type === "word" ? "Word" : "Math"} games are disabled in the dashboard`);
  let answer: string;
  let display: string;
  let image: Buffer;
  if (type === "word") {
    const list = guild.settings.games.wordRace.customWords.length ? guild.settings.games.wordRace.customWords : words;
    answer = list[randomInt(0, list.length - 1)]!.trim().toLowerCase();
    display = answer.toUpperCase();
    image = renderWordGameImage(answer);
  } else {
    const problem = generateMathProblem(guild.settings.games.mathRace.difficulty);
    answer = String(problem.answer);
    display = problem.expression;
    image = renderMathGameImage(problem.expression);
  }
  const expiresAt = new Date(Date.now() + config.answerSeconds * 1_000);
  const round = await createGameRound(db, {
    guildId: channel.guild.id, channelId: channel.id, type, answer,
    prompt: { display }, placeXp: config.placeXp, expiresAt,
  });
  const attachment = new AttachmentBuilder(image, { name: `${type}-race.png` });
  const sent = await channel.send({
    files: [attachment],
    embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(type === "word" ? "Type the word" : "Solve the equation")
      .setDescription(`${placeText(config.placeXp)}\n\nSend the answer in chat. Each member can place once.`)
      .setImage(`attachment://${type}-race.png`).setFooter({ text: `Ends in ${config.answerSeconds} seconds` })],
  }).catch(async (error) => {
    await db.update(gameRounds).set({ completedAt: new Date() }).where(eq(gameRounds.id, round.id));
    throw error;
  });
  await db.update(gameRounds).set({ messageId: sent.id }).where(eq(gameRounds.id, round.id));
  if (type === "word") {
    for (let hint = 1; hint <= guild.settings.games.wordRace.hints; hint += 1) {
      setTimeout(async () => {
        const active = await findActiveGameRound(db, channel.guild.id, channel.id);
        if (!active || active.id !== round.id) return;
        const visible = Math.max(1, Math.floor(answer.length * hint / (guild.settings.games.wordRace.hints + 1)));
        await channel.send({ content: `Hint ${hint}: \`${escapeMarkdown(answer.slice(0, visible).toUpperCase())}${"_".repeat(answer.length - visible)}\``, allowedMentions: { parse: [] } }).catch(() => undefined);
      }, config.answerSeconds * 1_000 * hint / (guild.settings.games.wordRace.hints + 1));
    }
  }
  setTimeout(() => void (async () => {
    const expired = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${round.id}))`);
      const [row] = await tx.update(gameRounds).set({ completedAt: new Date() }).where(and(eq(gameRounds.id, round.id), isNull(gameRounds.completedAt), lt(gameRounds.expiresAt, new Date(Date.now() + 500)))).returning();
      return row;
    });
    if (expired) await channel.send({ content: `Round over. The answer was **${escapeMarkdown(answer)}**.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  })().catch((error) => console.error("game_expiry_failed", { roundId: round.id, error })), config.answerSeconds * 1_000);
  return round;
}

export const startWordGame = (channel: GuildTextBasedChannel) => startGame(channel, "word");

export async function handleGameAnswer(message: Message) {
  if (!message.guild || !message.member || message.author.bot) return false;
  const round = await findActiveGameRound(db, message.guild.id, message.channel.id);
  if (!round || message.content.trim().toLowerCase() !== round.answer.trim().toLowerCase()) return false;
  const guild = await getOrCreateGuild(db, message.guild.id, message.guild.name);
  if (!guild.settings.enabled) return false;
  const claimed = await claimGameWinner(db, { roundId: round.id, userId: message.author.id, weekly: guild.settings.community.weeklyXp });
  if (!claimed) return false;
  const medal = ["first", "second", "third"][claimed.place - 1] ?? `#${claimed.place}`;
  await message.reply(`Correct. You placed **${medal}** and earned **${claimed.xpReward.toLocaleString()} XP**.${claimed.complete ? " The round is complete." : ""}`);
  return true;
}

export const handleGuess = handleGameAnswer;

async function schedulerCycle(client: Client) {
  const expired = await db.select({ id: gameRounds.id, channelId: gameRounds.channelId, answer: gameRounds.answer }).from(gameRounds)
    .where(and(isNull(gameRounds.completedAt), lt(gameRounds.expiresAt, new Date()))).limit(100);
  for (const round of expired) {
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${round.id}))`);
      const [row] = await tx.update(gameRounds).set({ completedAt: new Date() }).where(and(eq(gameRounds.id, round.id), isNull(gameRounds.completedAt), lt(gameRounds.expiresAt, new Date()))).returning();
      return row;
    });
    if (!claimed) continue;
    const channel = client.channels.cache.get(round.channelId);
    if (channel?.isSendable()) await channel.send({ content: `Round over. The answer was **${escapeMarkdown(round.answer)}**.`, allowedMentions: { parse: [] } }).catch((error) => console.error("game_expiry_delivery_failed", { roundId: round.id, error }));
  }
  for (const guild of client.guilds.cache.values()) {
    const row = await getOrCreateGuild(db, guild.id, guild.name);
    const rotation = row.settings.games.rotation;
    if (!rotation.enabled) continue;
    for (const channelId of rotation.channelIds) {
      await db.insert(gameSchedules).values({ guildId: guild.id, channelId, nextRunAt: new Date() }).onConflictDoNothing();
    }
  }
  const due = await db.select().from(gameSchedules).where(and(sql`${gameSchedules.nextRunAt} <= now()`, or(isNull(gameSchedules.leaseUntil), lt(gameSchedules.leaseUntil, new Date())))).limit(25);
  for (const schedule of due) {
    const [claimed] = await db.update(gameSchedules).set({ leaseUntil: new Date(Date.now() + 120_000) })
      .where(and(eq(gameSchedules.guildId, schedule.guildId), eq(gameSchedules.channelId, schedule.channelId), or(isNull(gameSchedules.leaseUntil), lt(gameSchedules.leaseUntil, new Date())))).returning();
    if (!claimed) continue;
    const guild = client.guilds.cache.get(schedule.guildId);
    const channel = guild?.channels.cache.get(schedule.channelId);
    const row = guild ? await getOrCreateGuild(db, guild.id, guild.name) : null;
    if (!guild || !channel?.isTextBased() || channel.isDMBased() || !row || !row.settings.games.rotation.enabled || !row.settings.games.rotation.channelIds.includes(schedule.channelId)) {
      await db.delete(gameSchedules).where(and(eq(gameSchedules.guildId, schedule.guildId), eq(gameSchedules.channelId, schedule.channelId)));
      continue;
    }
    const rotation = row.settings.games.rotation;
    const enabledTypes = rotation.types.filter((type) => type === "word" ? row.settings.games.wordRace.enabled : row.settings.games.mathRace.enabled);
    if (!enabledTypes.length) {
      await db.update(gameSchedules).set({ nextRunAt: new Date(Date.now() + rotation.intervalMinutes * 60_000), leaseUntil: null, updatedAt: new Date() }).where(and(eq(gameSchedules.guildId, schedule.guildId), eq(gameSchedules.channelId, schedule.channelId)));
      continue;
    }
    const type = rotation.mode === "round-robin" ? enabledTypes[schedule.rotationIndex % enabledTypes.length]! : enabledTypes[randomInt(0, enabledTypes.length - 1)]!;
    await startGame(channel, type).catch((error) => console.error("scheduled_game_failed", { guildId: guild.id, channelId: channel.id, type, error }));
    await db.update(gameSchedules).set({
      nextRunAt: new Date(Date.now() + rotation.intervalMinutes * 60_000),
      rotationIndex: schedule.rotationIndex + 1, leaseUntil: null, updatedAt: new Date(),
    }).where(and(eq(gameSchedules.guildId, schedule.guildId), eq(gameSchedules.channelId, schedule.channelId)));
  }
}

export function scheduleGames(client: Client) {
  const loop = async () => {
    await schedulerCycle(client).catch(console.error);
    setTimeout(loop, 60_000);
  };
  void loop();
}
