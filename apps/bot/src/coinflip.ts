import { ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type GuildMember, type Message } from "discord.js";
import { acceptCoinflipChallenge, coinflipChallenges, createCoinflipChallenge, db, declineCoinflipChallenge, eq, expireCoinflipChallenges, getOrCreateGuild, getRank } from "@inochi/database";
import { icon } from "./emojis";
import { INOCHI_NAVY } from "./theme";

type Side = "heads" | "tails";
type Challenge = {
  id: string;
  guildId: string;
  channelId?: string;
  messageId?: string | null;
  challengerId: string;
  opponentId: string;
  wager: number;
  challengerSide: Side;
  expiresAt: Date;
};

function challengePanel(challenge: Challenge, state: "open" | "declined" | "expired" = "open") {
  const side = challenge.challengerSide;
  const status = state === "open"
    ? `<@${challenge.challengerId}> chose **${side}** and challenged <@${challenge.opponentId}> for **${challenge.wager.toLocaleString()} XP each**.\nExpires <t:${Math.floor(challenge.expiresAt.getTime() / 1000)}:R>.`
    : state === "declined" ? "The challenge was declined." : "The challenge expired.";
  const container = new ContainerBuilder().setAccentColor(INOCHI_NAVY).addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Coinflip challenge\n${status}`));
  if (state === "open") container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`coinflip:accept:${challenge.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`coinflip:decline:${challenge.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
  ));
  return container;
}

function gameSettings(settings: unknown) {
  return (settings as Awaited<ReturnType<typeof getOrCreateGuild>>["settings"]).games.coinflip;
}

export async function startCoinflip(interaction: ChatInputCommandInteraction, opponent: GuildMember, wager: number, side: Side) {
  await interaction.deferReply();
  if (!interaction.guildId || !interaction.guild) throw new Error("This command only works in a server");
  if (opponent.user.bot) throw new Error("Bots cannot accept coinflip challenges");
  if (opponent.id === interaction.user.id) throw new Error("Choose another member");
  const guild = await getOrCreateGuild(db, interaction.guildId, interaction.guild.name);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  const settings = gameSettings(guild.settings);
  if (!settings.enabled) throw new Error("Coinflip is disabled in this server");
  if (wager < settings.minWager || wager > settings.maxWager) throw new Error(`Wager between ${settings.minWager.toLocaleString()} and ${settings.maxWager.toLocaleString()} XP`);
  const [challengerRank, opponentRank] = await Promise.all([getRank(db, interaction.guildId, interaction.user.id), getRank(db, interaction.guildId, opponent.id)]);
  if ((challengerRank?.xp ?? 0) < wager) throw new Error("You do not have enough XP for that wager");
  if ((opponentRank?.xp ?? 0) < wager) throw new Error(`${opponent.displayName} does not have enough XP for that wager`);
  const challenge = await createCoinflipChallenge(db, {
    interactionKey: interaction.id,
    guildId: interaction.guildId, channelId: interaction.channelId, challengerId: interaction.user.id, opponentId: opponent.id,
    wager, challengerSide: side, expiresAt: new Date(Date.now() + settings.challengeSeconds * 1_000),
  });
  await interaction.editReply({ components: [challengePanel(challenge)], flags: MessageFlags.IsComponentsV2 });
  const response = await interaction.fetchReply();
  await db.update(coinflipChallenges).set({ messageId: response.id }).where(eq(coinflipChallenges.id, challenge.id));
}

export async function startCoinflipMessage(message: Message<true>, opponent: GuildMember, wager: number, side: Side) {
  if (opponent.user.bot || opponent.id === message.author.id) throw new Error("Choose another non-bot member");
  const guild = await getOrCreateGuild(db, message.guildId, message.guild.name);
  if (!guild.settings.enabled) throw new Error("XP is disabled in this server");
  const settings = gameSettings(guild.settings);
  if (!settings.enabled) throw new Error("Coinflip is disabled in this server");
  if (wager < settings.minWager || wager > settings.maxWager) throw new Error(`Wager between ${settings.minWager.toLocaleString()} and ${settings.maxWager.toLocaleString()} XP`);
  const [challengerRank, opponentRank] = await Promise.all([getRank(db, message.guildId, message.author.id), getRank(db, message.guildId, opponent.id)]);
  if ((challengerRank?.xp ?? 0) < wager || (opponentRank?.xp ?? 0) < wager) throw new Error("Both members need enough XP for the wager");
  const challenge = await createCoinflipChallenge(db, {
    interactionKey: message.id,
    guildId: message.guildId, channelId: message.channelId, challengerId: message.author.id, opponentId: opponent.id,
    wager, challengerSide: side, expiresAt: new Date(Date.now() + settings.challengeSeconds * 1_000),
  });
  if (!message.channel.isSendable()) throw new Error("I cannot send a challenge in this channel");
  const sent = await message.channel.send({ components: [challengePanel(challenge)], flags: MessageFlags.IsComponentsV2 });
  await db.update(coinflipChallenges).set({ messageId: sent.id }).where(eq(coinflipChallenges.id, challenge.id));
}

export async function handleCoinflipComponent(interaction: ButtonInteraction) {
  if (!interaction.customId.startsWith("coinflip:")) return false;
  if (!interaction.inGuild() || !interaction.guild) throw new Error("This challenge only works in a server");
  const [, action, challengeId] = interaction.customId.split(":");
  await interaction.deferUpdate();
  if (!challengeId) throw new Error("Invalid coinflip challenge");
  if (action === "decline") {
    const challenge = await declineCoinflipChallenge(db, { challengeId, opponentId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId });
    await interaction.editReply({ components: [challengePanel(challenge, challenge.status === "expired" ? "expired" : "declined")] });
    return true;
  }
  if (action !== "accept") throw new Error("Unknown coinflip action");
  const guildSettings = await getOrCreateGuild(db, interaction.guildId, interaction.guild.name);
  if (!guildSettings.settings.enabled) throw new Error("XP is disabled in this server");
  const settlement = await acceptCoinflipChallenge(db, { challengeId, opponentId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId });
  const outcome = settlement.challenge;
  if (outcome.status !== "completed" || !outcome.outcome || !outcome.winnerId) throw new Error("This coinflip challenge expired");
  const result = outcome.outcome;
  const winnerId = outcome.winnerId;
  await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(INOCHI_NAVY).addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${icon(interaction.client, "coinflip")} ${result[0]!.toUpperCase()}${result.slice(1)}\n<@${winnerId}> won **${outcome.wager.toLocaleString()} XP** from <@${winnerId === outcome.challengerId ? outcome.opponentId : outcome.challengerId}>.`,
  ))] });
  const { syncMember } = await import("./commands/handler");
  const guild = interaction.guild;
  await Promise.all([outcome.challengerId, outcome.opponentId].map(async (id) => {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member) await syncMember(member).catch(() => undefined);
  }));
  return true;
}

export async function expireCoinflips(client: Client) {
  const expired = await expireCoinflipChallenges(db);
  for (const challenge of expired) {
    if (!challenge.channelId || !challenge.messageId) continue;
    const channel = client.channels.cache.get(challenge.channelId);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(challenge.messageId).catch(() => null) as Message | null;
    if (message) await message.edit({ components: [challengePanel(challenge, "expired")] }).catch(() => undefined);
  }
}
