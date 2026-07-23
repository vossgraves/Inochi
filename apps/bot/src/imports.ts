import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  UserSelectMenuBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { and, applyImport, count, db, eq, gt, importEntries, importSessions, or, sql } from "@inochi/database";
import {
  importProviderIds,
  importProviders,
  isImportProviderId,
  type ImportProviderId,
  type ImportRecord,
  type ImportStrategy,
  type LeaderboardMessageSnapshot,
} from "@inochi/importers";
import { xpForLevel } from "@inochi/core";
import { getOrCreateGuild } from "@inochi/database";
import { INOCHI_NAVY } from "./theme";

type ImportComponentInteraction = ButtonInteraction | AnySelectMenuInteraction;
type Session = typeof importSessions.$inferSelect;
const MAX_IMPORT_RECORDS = 100_000;

async function currentGuildMemberIds(guild: Guild) {
  const ids = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const batch = await guild.members.list({ after, limit: 1_000, cache: false });
    for (const member of batch.values()) if (!member.user.bot) ids.add(member.id);
    if (batch.size < 1_000) break;
    after = batch.lastKey();
    if (!after) break;
  }
  return ids;
}

async function insertEntries(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], sessionId: string, records: ImportRecord[]) {
  const deduplicated = [...new Map(records.map((record) => [record.userId, record])).values()].slice(0, MAX_IMPORT_RECORDS);
  for (let offset = 0; offset < deduplicated.length; offset += 500) {
    const batch = deduplicated.slice(offset, offset + 500).map((record) => ({ sessionId, ...record, sourcePage: record.page }));
    if (!batch.length) continue;
    await tx.insert(importEntries).values(batch).onConflictDoUpdate({
      target: [importEntries.sessionId, importEntries.userId],
      set: { xp: sql`excluded.xp`, level: sql`excluded.level`, exact: sql`excluded.exact`, metric: sql`excluded.metric`, sourcePage: sql`excluded.source_page` },
    });
  }
  return deduplicated.length;
}

async function createSession(input: {
  guildId: string;
  channelId: string;
  createdBy: string;
  source: ImportProviderId;
  strategy: ImportStrategy;
  sourceBotId: string;
  status?: "collecting" | "review";
  expiresAt: Date;
  capturedPages?: number[];
  warnings?: string[];
}, records: ImportRecord[] = []) {
  return db.transaction(async (tx) => {
    const lockKeys = [`${input.guildId}:${input.channelId}:${input.source}:import`, `${input.guildId}:${input.channelId}:${input.sourceBotId}:import`].sort();
    for (const lockKey of lockKeys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const active = await tx.query.importSessions.findFirst({
      where: and(eq(importSessions.guildId, input.guildId), eq(importSessions.channelId, input.channelId), or(eq(importSessions.source, input.source), eq(importSessions.sourceBotId, input.sourceBotId)), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, new Date())),
    });
    if (active) throw new Error("An import from this source is already active in this channel");
    const [session] = await tx.insert(importSessions).values(input).returning();
    if (!session) throw new Error("Could not create the import session");
    await insertEntries(tx, session.id, records);
    return session;
  });
}

function providerSelect(selected?: ImportProviderId, disabled = false) {
  return new StringSelectMenuBuilder().setCustomId("import:source:new").setPlaceholder("Choose the leveling bot").addOptions(
    ...importProviderIds.map((value) => ({ label: importProviders[value].label, value, default: value === selected })),
  ).setDisabled(disabled);
}

function panel(options: { source?: ImportProviderId; session?: Session; details?: string; confirm?: boolean; chooseBot?: boolean; busy?: boolean; customBotId?: string } = {}) {
  const { session, details, confirm = false, chooseBot = false, busy = false, customBotId } = options;
  const selected = session?.source && isImportProviderId(session.source) ? session.source : options.source;
  const provider = selected ? importProviders[selected] : undefined;
  const status = session
    ? `**Session:** \`${session.id}\`\n**Source:** ${provider?.label ?? session.source}\n**Strategy:** ${session.strategy ?? "message"}\n**Source bot:** ${session.sourceBotId ? `<@${session.sourceBotId}>` : "not selected"}\n**Status:** ${session.status}\nExpires <t:${Math.floor(session.expiresAt.getTime() / 1000)}:R>`
    : "Choose a source. Inochi checks that its bot is installed, then prefers a verified public leaderboard and falls back to message capture.";
  const id = session?.id ?? selected ?? "none";
  const active = session && (session.status === "collecting" || session.status === "review");
  const container = new ContainerBuilder().setAccentColor(INOCHI_NAVY)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## XP import\n${status}${details ? `\n\n${details}` : ""}`))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerSelect(selected, Boolean(session) || busy)));
  if (!session && selected && !busy) container.addActionRowComponents(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(`import:bot:${selected}`).setPlaceholder(`Select ${provider!.label} premium/custom bot`).setMinValues(1).setMaxValues(1),
  ));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`import:start:${id}`).setLabel("Auto-detect & start").setStyle(ButtonStyle.Primary).setDisabled(Boolean(session) || !selected || chooseBot || busy),
    new ButtonBuilder().setCustomId(`import:review:${id}`).setLabel("Review").setStyle(ButtonStyle.Secondary).setDisabled(!active),
    new ButtonBuilder().setCustomId(`import:apply:${id}${confirm ? ":confirm" : ""}`).setLabel(confirm ? "Confirm apply" : "Apply").setStyle(confirm ? ButtonStyle.Danger : ButtonStyle.Primary).setDisabled(session?.status !== "review"),
    new ButtonBuilder().setCustomId(`import:stop:${id}`).setLabel("Stop").setStyle(ButtonStyle.Danger).setDisabled(!active),
  );
  if (!session && selected && customBotId) buttons.addComponents(new ButtonBuilder().setCustomId(`import:startcustom:${selected}:${customBotId}`).setLabel("Confirm custom bot").setStyle(ButtonStyle.Danger));
  container.addActionRowComponents(buttons);
  return container;
}

export async function showImportPanel(interaction: ChatInputCommandInteraction) {
  const value = interaction.options.getString("source");
  const source = value && isImportProviderId(value) ? value : undefined;
  await interaction.reply({ components: [panel({ source })], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

export async function showImportPanelMessage(message: Message<true>, value?: string) {
  if (value && !isImportProviderId(value)) throw new Error(`Source must be one of: ${importProviderIds.join(", ")}`);
  await message.reply({ components: [panel({ source: value as ImportProviderId | undefined })], flags: MessageFlags.IsComponentsV2 });
}

async function sessionFor(interaction: ImportComponentInteraction, id: string) {
  if (!interaction.guildId) throw new Error("This import only works in a server");
  const session = await db.query.importSessions.findFirst({ where: and(eq(importSessions.id, id), eq(importSessions.guildId, interaction.guildId)) });
  if (!session) throw new Error("This import session no longer exists");
  if (session.expiresAt <= new Date()) throw new Error("This import session expired");
  if (session.createdBy !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Only the initiator or a server manager can control this import");
  return session;
}

async function knownProviderBot(interaction: ImportComponentInteraction, source: ImportProviderId) {
  for (const userId of importProviders[source].botUserIds) {
    const member = await interaction.guild!.members.fetch(userId).catch(() => null);
    if (member?.user.bot) return member;
  }
  return null;
}

async function beginImport(interaction: ImportComponentInteraction, source: ImportProviderId, sourceBotId: string) {
  const provider = importProviders[source];
  let strategy: ImportStrategy = "message";
  let records: ImportRecord[] = [];
  let warnings: string[] = [];
  let pages: number[] = [];
  if (provider.fetchPublic) {
    await interaction.editReply({ components: [panel({ source, busy: true, details: `Found <@${sourceBotId}>. Checking ${provider.label}'s public leaderboard...` })] });
    try {
      const result = await provider.fetchPublic(interaction.guildId!);
      if (result.records.length) {
        strategy = "web";
        records = result.records;
        warnings = result.warnings;
        pages = Array.from({ length: result.pages }, (_, index) => index + (source === "mee6" ? 0 : 1));
      } else warnings.push("The public leaderboard returned no records; switched to message capture.");
    } catch (error) {
      warnings.push(`${error instanceof Error ? error.message : "Public leaderboard unavailable"}; switched to message capture.`);
    }
  }
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const session = await createSession({
    guildId: interaction.guildId!, channelId: interaction.channelId, createdBy: interaction.user.id, source, strategy, sourceBotId,
    status: strategy === "web" ? "review" : "collecting", expiresAt, capturedPages: pages, warnings,
  }, records);
  const details = strategy === "web"
    ? `Loaded **${records.length.toLocaleString()}** records from ${provider.label}'s public leaderboard.${warnings.length ? `\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : ""}`
    : `${provider.messageInstructions}\nOnly public, non-ephemeral messages from <@${sourceBotId}> in this channel will be captured.${warnings.length ? `\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : ""}`;
  await interaction.editReply({ components: [panel({ session, details })] });
}

export async function handleImportComponent(interaction: ImportComponentInteraction) {
  if (!interaction.customId.startsWith("import:")) return false;
  if (!interaction.inGuild() || !interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Manage Server permission is required");
  const [, action, id, extra] = interaction.customId.split(":");
  await interaction.deferUpdate();
  if (action === "source" && interaction.isStringSelectMenu()) {
    const source = interaction.values[0];
    if (!source || !isImportProviderId(source)) throw new Error("Choose a supported import source");
    await interaction.editReply({ components: [panel({ source, details: `Select a premium/custom bot below, or let Inochi detect ${importProviders[source].label}'s official bot.` })] });
    return true;
  }
  if (action === "bot" && interaction.isUserSelectMenu()) {
    if (!id || !isImportProviderId(id)) throw new Error("Choose an import source first");
    const userId = interaction.values[0];
    const member = userId ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
    if (!member?.user.bot) throw new Error("Select a bot that is installed in this server");
    await interaction.editReply({ components: [panel({ source: id, customBotId: member.id, details: `<@${member.id}> is not a verified ${importProviders[id].label} identity. Confirm only if this is the installed premium/custom bot you intend to trust for this import.` })] });
    return true;
  }
  if (action === "startcustom") {
    if (!id || !isImportProviderId(id) || !extra) throw new Error("Choose an import source and custom bot first");
    const member = await interaction.guild.members.fetch(extra).catch(() => null);
    if (!member?.user.bot) throw new Error("The selected custom bot is no longer installed in this server");
    await beginImport(interaction, id, member.id);
    return true;
  }
  if (action === "start") {
    if (!id || !isImportProviderId(id)) throw new Error("Choose an import source first");
    const member = await knownProviderBot(interaction, id);
    if (!member) {
      await interaction.editReply({ components: [panel({ source: id, chooseBot: true, details: `${importProviders[id].label} is not installed in this server under a known official identity. Select its installed premium/custom bot below to continue.` })] });
      return true;
    }
    await beginImport(interaction, id, member.id);
    return true;
  }
  if (!id) throw new Error("Invalid import control");
  const session = await sessionFor(interaction, id);
  if (action === "stop") {
    const updatedAt = new Date();
    const stopped = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.id}))`);
      const [row] = await tx.update(importSessions).set({ status: "cancelled", updatedAt }).where(and(eq(importSessions.id, session.id), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, updatedAt))).returning();
      return row;
    });
    if (!stopped) throw new Error("This import session is no longer active");
    await interaction.editReply({ components: [panel({ session: stopped, details: "Import stopped." })] });
    return true;
  }
  const [total] = await db.select({ value: count() }).from(importEntries).where(eq(importEntries.sessionId, session.id));
  if (action === "review") {
    const updatedAt = new Date();
    const review = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.id}))`);
      const [freshTotal] = await tx.select({ value: count() }).from(importEntries).where(eq(importEntries.sessionId, session.id));
      const [freshApproximate] = await tx.select({ value: count() }).from(importEntries).where(and(eq(importEntries.sessionId, session.id), eq(importEntries.exact, false)));
      if (!freshTotal?.value) throw new Error(session.recognizedMessages > 0 ? "Leaderboard messages were recognized, but no importable member IDs and XP values were found" : "No leaderboard records have been captured yet");
      const [reviewed] = await tx.update(importSessions).set({ status: "review", updatedAt }).where(and(eq(importSessions.id, session.id), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, updatedAt))).returning();
      if (!reviewed) throw new Error("This import session is no longer active");
      return { reviewed, total: freshTotal.value, approximate: freshApproximate?.value ?? 0 };
    });
    const { reviewed } = review;
    const warningText = reviewed.warnings.length ? `\n${reviewed.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
    await interaction.editReply({ components: [panel({ session: reviewed, details: `Captured **${review.total.toLocaleString()}** members across **${reviewed.capturedPages.length}** detected pages. **${review.approximate.toLocaleString()}** entries are level-only estimates.${warningText}` })] });
    return true;
  }
  if (action === "apply" && !interaction.customId.endsWith(":confirm")) {
    if (session.status !== "review" || !total?.value) throw new Error("Review a non-empty import before applying it");
    await interaction.editReply({ components: [panel({ session, details: `This replaces XP for **${total.value.toLocaleString()}** records. Select **Confirm apply** to continue.`, confirm: true })] });
    return true;
  }
  if (action === "apply") {
    if (session.status !== "review" || !total?.value) throw new Error("Review a non-empty import before applying it");
    const guild = await getOrCreateGuild(db, interaction.guildId, interaction.guild.name);
    const excludedBots = new Set([interaction.client.user.id, session.sourceBotId, ...Object.values(importProviders).flatMap((provider) => [...provider.botUserIds])].filter(Boolean));
    const guildMemberIds = await currentGuildMemberIds(interaction.guild);
    const imported = await applyImport(db, { sessionId: session.id, actorId: interaction.user.id, approximateXp: (level) => xpForLevel(level, guild.settings), includeUser: (userId) => guildMemberIds.has(userId) && !excludedBots.has(userId) });
    await interaction.editReply({ components: [panel({ session: { ...session, status: "completed", completedAt: new Date(), updatedAt: new Date() }, details: `Applied **${imported.toLocaleString()}** member records.` })] });
    return true;
  }
  throw new Error("Unknown import action");
}

export function snapshotForImportMessage(message: Message): LeaderboardMessageSnapshot {
  return {
    content: message.content,
    embeds: message.embeds.map((embed) => ({
      author: embed.author?.name, title: embed.title ?? undefined, description: embed.description ?? undefined,
      fields: embed.fields.map((field) => ({ name: field.name, value: field.value })), footer: embed.footer?.text, url: embed.url ?? undefined,
    })),
    components: message.components.flatMap((row) => "components" in row ? row.components.map((component) => "label" in component && component.label ? component.label : "") : []).filter(Boolean),
    attachments: message.attachments.map((attachment) => ({ name: attachment.name, contentType: attachment.contentType ?? undefined })),
  };
}

export async function captureImportMessage(message: Message) {
  if (!message.guild || !message.author.bot) return;
  const session = await db.query.importSessions.findFirst({
    where: and(eq(importSessions.guildId, message.guild.id), eq(importSessions.channelId, message.channel.id), eq(importSessions.sourceBotId, message.author.id), eq(importSessions.status, "collecting"), gt(importSessions.expiresAt, new Date())),
  });
  if (!session || !isImportProviderId(session.source)) return;
  const snapshot = snapshotForImportMessage(message);
  const result = importProviders[session.source].parseMessage(snapshot);
  if (!result.recognized && !result.records.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.id}))`);
    const current = await tx.query.importSessions.findFirst({ where: and(eq(importSessions.id, session.id), eq(importSessions.status, "collecting"), gt(importSessions.expiresAt, new Date())) });
    if (!current) return;
    const [existing] = await tx.select({ value: count() }).from(importEntries).where(eq(importEntries.sessionId, session.id));
    const remaining = Math.max(0, MAX_IMPORT_RECORDS - (existing?.value ?? 0));
    await insertEntries(tx, session.id, result.records.slice(0, remaining));
    const pages = result.page === undefined ? current.capturedPages : [...new Set([...current.capturedPages, result.page])].sort((a, b) => a - b);
    const warnings = [...new Set([...current.warnings, ...result.warnings])].slice(-25);
    const rawSnapshot = [...current.rawSnapshot, { messageId: message.id, authorId: message.author.id, snapshot, capturedAt: new Date().toISOString() }].slice(-100);
    await tx.update(importSessions).set({ sourceMessageId: message.id, rawSnapshot, capturedPages: pages, warnings, recognizedMessages: current.recognizedMessages + (result.recognized ? 1 : 0), updatedAt: new Date() }).where(and(eq(importSessions.id, session.id), eq(importSessions.status, "collecting")));
  });
  if (result.recognized && !result.records.length && session.recognizedMessages === 0 && message.channel.isSendable()) {
    await message.channel.send({ content: `I recognized ${importProviders[session.source].label}'s leaderboard, but it did not expose Discord member IDs with XP or level values. Try another public leaderboard format or an official export.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}
