import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { createHash } from "node:crypto";
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
import { and, applyImport, count, CURRENT_IMPORT_FORMAT_VERSION, db, eq, gt, importCapturedMessages, importEntries, importSessions, or, prepareImportSession, sql } from "@inochi/database";
import {
  importProviderIds,
  importProviders,
  isImportProviderId,
  type ImportProviderId,
  type ImportRecord,
  type ImportStrategy,
  type LeaderboardMessageSnapshot,
} from "@inochi/importers";
import { applyLevelingPreset, levelingPresets, xpForLevel, type LevelingPresetName } from "@inochi/core";
import { getOrCreateGuild } from "@inochi/database";
import { INOCHI_NAVY } from "./theme";

type ImportComponentInteraction = ButtonInteraction | AnySelectMenuInteraction;
type Session = typeof importSessions.$inferSelect;
const MAX_IMPORT_RECORDS = 100_000;
const PRESET_SETTINGS = ["gain", "curve", "multipliers"] as const;
const xpModeLabels = { replace: "Replace matching XP", missing: "Only missing members", greater: "Keep greater XP" } as const;

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

async function synchronizeImportedRoles(interaction: ImportComponentInteraction, userIds: string[]) {
  const { syncMember } = await import("./commands/handler");
  let synchronized = 0;
  let failed = 0;
  for (let offset = 0; offset < userIds.length; offset += 5) {
    await Promise.all(userIds.slice(offset, offset + 5).map(async (userId) => {
      const member = await interaction.guild!.members.fetch(userId).catch(() => null);
      if (!member) { failed += 1; return; }
      const result = await syncMember(member).catch(() => null);
      if (result) synchronized += 1;
      else failed += 1;
    }));
  }
  await interaction.followUp({ content: `Reward-role synchronization finished for **${synchronized.toLocaleString()}** members${failed ? `; **${failed.toLocaleString()}** could not be synchronized` : ""}.`, ephemeral: true }).catch(() => undefined);
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

function sourcePreset(source: ImportProviderId) {
  return importProviders[source].knownPreset as LevelingPresetName | undefined;
}

function expectedPageState(source: ImportProviderId, capturedPages: number[], totalPages?: number) {
  const first = source === "mee6" ? 0 : 1;
  const unique = [...new Set(capturedPages)].sort((a, b) => a - b);
  const count = totalPages && totalPages > 0 ? totalPages : undefined;
  const last = count ? first + count - 1 : unique.at(-1);
  const complete = count !== undefined ? Array.from({ length: count }, (_, index) => first + index).every((page) => unique.includes(page)) : undefined;
  return { count, first, last, complete };
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
  if (session?.status === "review") {
    const preset = selected ? sourcePreset(selected) : undefined;
    const presetSelected = PRESET_SETTINGS.every((key) => session.selectedSettings.includes(key));
    const reviewControls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`import:mode:${session.id}:${session.xpApplyMode}`).setLabel(xpModeLabels[session.xpApplyMode]).setStyle(ButtonStyle.Secondary),
    );
    if (preset) reviewControls.addComponents(new ButtonBuilder().setCustomId(`import:preset:${session.id}:${presetSelected ? "on" : "off"}`).setLabel(`${levelingPresets[preset].label} preset: ${presetSelected ? "On" : "Off"}`).setStyle(presetSelected ? ButtonStyle.Success : ButtonStyle.Secondary));
    container.addActionRowComponents(reviewControls);
  }
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
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  let session = await createSession({
    guildId: interaction.guildId!, channelId: interaction.channelId, createdBy: interaction.user.id, source, strategy: provider.fetchPublic ? "web" : "message", sourceBotId,
    status: "collecting", expiresAt,
  });
  let details = `${provider.messageInstructions}\nOnly public, non-ephemeral messages from <@${sourceBotId}> in this channel will be captured.`;
  if (provider.fetchPublic) {
    await interaction.editReply({ components: [panel({ source, busy: true, details: `Found <@${sourceBotId}>. Checking ${provider.label}'s public leaderboard...` })] });
    try {
      const result = await provider.fetchPublic(interaction.guildId!);
      if (result.records.length) {
        const pages = Array.from({ length: result.pages }, (_, index) => index + (source === "mee6" ? 0 : 1));
        session = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.id}))`);
          await insertEntries(tx, session.id, result.records);
          const pageState = { ...expectedPageState(source, pages, result.expectedPages), complete: result.complete };
          const [updated] = await tx.update(importSessions).set({ strategy: "web", capturedPages: pages, warnings: result.warnings, expectedPages: pageState, updatedAt: new Date() }).where(and(eq(importSessions.id, session.id), eq(importSessions.status, "collecting"))).returning();
          if (!updated) throw new Error("Import session changed while loading the public leaderboard");
          return updated;
        });
        details = `Loaded **${result.records.length.toLocaleString()}** records from ${provider.label}'s public leaderboard.${result.warnings.length ? `\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : ""}`;
      } else {
        const warnings = [...result.warnings, "The public leaderboard returned no records; switched to message capture."];
        const [updated] = await db.update(importSessions).set({ strategy: "message", warnings, updatedAt: new Date() }).where(eq(importSessions.id, session.id)).returning();
        if (updated) session = updated;
        details += `\n${warnings.map((warning) => `- ${warning}`).join("\n")}`;
      }
    } catch (error) {
      const warning = `${error instanceof Error ? error.message : "Public leaderboard unavailable"}; switched to message capture.`;
      const [updated] = await db.update(importSessions).set({ strategy: "message", warnings: [warning], lastError: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(importSessions.id, session.id)).returning();
      if (updated) session = updated;
      details += `\n- ${warning}`;
    }
  }
  await interaction.editReply({ components: [panel({ session, details })] });
}

export async function handleImportComponent(interaction: ImportComponentInteraction) {
  if (!interaction.customId.startsWith("import:")) return false;
  if (!interaction.inGuild() || !interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Manage Server permission is required");
  const [, action, id, extra] = interaction.customId.split(":");
  await interaction.deferUpdate();
  try {
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
  if (action === "preset") {
    const preset = isImportProviderId(session.source) ? sourcePreset(session.source) : undefined;
    if (!preset || !session.settingsProposal) throw new Error("This source does not have a verified settings preset");
    const selectedSettings = extra === "on" ? [] : [...PRESET_SETTINGS];
    const prepared = await prepareImportSession(db, { sessionId: session.id, selectedSettings });
    await interaction.editReply({ components: [panel({ session: prepared, details: `${levelingPresets[preset].label} progression settings will ${selectedSettings.length ? "be applied with" : "not be changed by"} this import.` })] });
    return true;
  }
  if (action === "mode") {
    const modes = ["replace", "missing", "greater"] as const;
    const current = modes.indexOf(session.xpApplyMode);
    const xpApplyMode = modes[(current + 1) % modes.length]!;
    const prepared = await prepareImportSession(db, { sessionId: session.id, xpApplyMode });
    await interaction.editReply({ components: [panel({ session: prepared, details: `XP behavior: **${xpModeLabels[xpApplyMode]}**.` })] });
    return true;
  }
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
    const preset = isImportProviderId(session.source) ? sourcePreset(session.source) : undefined;
    const expectedPages = session.expectedPages ?? expectedPageState(session.source as ImportProviderId, session.capturedPages);
    const reviewed = await prepareImportSession(db, {
      sessionId: session.id,
      formatVersion: CURRENT_IMPORT_FORMAT_VERSION,
      preset: preset ?? null,
      selectedSettings: preset ? [...PRESET_SETTINGS] : [],
      xpApplyMode: session.xpApplyMode,
      expectedPages,
      allowApproximate: Boolean(preset),
    });
    const { records, approximate } = reviewed.previewSummary;
    const warningText = reviewed.warnings.length ? `\n${reviewed.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
    const pageWarning = reviewed.expectedPages?.complete === false ? "\n- **Warning:** Not every advertised leaderboard page has been captured." : "";
    const presetText = preset ? `\n**Settings:** ${levelingPresets[preset].label} preset preselected (${levelingPresets[preset].description}).` : "\n**Settings:** No verified provider preset; existing settings will remain unchanged.";
    await interaction.editReply({ components: [panel({ session: reviewed, details: `Captured **${records.toLocaleString()}** members across **${reviewed.capturedPages.length}** detected pages. **${approximate.toLocaleString()}** entries are level-only estimates.${presetText}\n**XP behavior:** ${xpModeLabels[reviewed.xpApplyMode]}.${pageWarning}${warningText}` })] });
    return true;
  }
  if (action === "apply" && !interaction.customId.endsWith(":confirm")) {
    if (session.status !== "review" || !total?.value) throw new Error("Review a non-empty import before applying it");
    const preset = isImportProviderId(session.source) ? sourcePreset(session.source) : undefined;
    const appliesPreset = preset && PRESET_SETTINGS.every((key) => session.selectedSettings.includes(key));
    await interaction.editReply({ components: [panel({ session, details: `This will use **${xpModeLabels[session.xpApplyMode]}** for up to **${total.value.toLocaleString()}** records${appliesPreset ? ` and apply the **${levelingPresets[preset].label}** progression preset` : " without changing progression settings"}. A pre-import safety backup will be created. Select **Confirm apply** to continue.`, confirm: true })] });
    return true;
  }
  if (action === "apply") {
    if (session.status !== "review" || !total?.value) throw new Error("Review a non-empty import before applying it");
    const guild = await getOrCreateGuild(db, interaction.guildId, interaction.guild.name);
    const excludedBots = new Set([interaction.client.user.id, session.sourceBotId, ...Object.values(importProviders).flatMap((provider) => [...provider.botUserIds])].filter(Boolean));
    const guildMemberIds = await currentGuildMemberIds(interaction.guild);
    const preset = isImportProviderId(session.source) ? sourcePreset(session.source) : undefined;
    const conversionSettings = preset ? applyLevelingPreset(guild.settings, preset) : guild.settings;
    const allowedUserIds = new Set([...guildMemberIds].filter((userId) => !excludedBots.has(userId)));
    const result = await applyImport(db, { sessionId: session.id, actorId: interaction.user.id, approximateXp: (level) => xpForLevel(level, conversionSettings), includeUser: (userId) => allowedUserIds.has(userId) });
    const completedSession = { ...session, status: "completed" as const, applyResult: { ...result }, completedAt: new Date(result.completedAt), updatedAt: new Date(result.completedAt) };
    await interaction.editReply({ components: [panel({ session: completedSession, details: `Applied XP to **${result.applied.toLocaleString()}** members. **${result.skipped.toLocaleString()}** were unchanged and **${result.excluded.toLocaleString()}** were excluded.${result.settingsApplied.length ? ` Applied progression settings: ${result.settingsApplied.join(", ")}.` : " Existing settings were preserved."}\nSafety backup: \`${result.backupId}\`.` })] });
    const roleSyncIds = result.settingsApplied.length ? [...allowedUserIds] : result.changedUserIds;
    if (!result.idempotent && roleSyncIds.length) void synchronizeImportedRoles(interaction, roleSyncIds).catch(console.error);
    return true;
  }
    throw new Error("Unknown import action");
  } catch (error) {
    if (id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
      await db.update(importSessions).set({ lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000), updatedAt: new Date() }).where(eq(importSessions.id, id)).catch(() => undefined);
    }
    throw error;
  }
}

export function snapshotForImportMessage(message: Message): LeaderboardMessageSnapshot {
  return {
    content: message.content,
    embeds: message.embeds.map((embed) => ({
      author: embed.author?.name, title: embed.title ?? undefined, description: embed.description ?? undefined,
      fields: embed.fields.map((field) => ({ name: field.name, value: field.value })), footer: embed.footer?.text, url: embed.url ?? undefined,
    })),
    components: message.components.map((row) => row.toJSON()),
    attachments: message.attachments.map((attachment) => ({ name: attachment.name, contentType: attachment.contentType ?? undefined })),
  };
}

export async function captureImportMessage(message: Message) {
  if (!message.guild || !message.author.bot) return;
  const session = await db.query.importSessions.findFirst({
    where: and(eq(importSessions.guildId, message.guild.id), eq(importSessions.channelId, message.channel.id), eq(importSessions.sourceBotId, message.author.id), eq(importSessions.strategy, "message"), eq(importSessions.status, "collecting"), gt(importSessions.expiresAt, new Date())),
  });
  if (!session || !isImportProviderId(session.source)) return;
  const source = session.source;
  const snapshot = snapshotForImportMessage(message);
  const result = importProviders[source].parseMessage(snapshot);
  if (!result.recognized && !result.records.length) {
    const prior = await db.query.importCapturedMessages.findFirst({ where: and(eq(importCapturedMessages.sessionId, session.id), eq(importCapturedMessages.messageId, message.id)) });
    if (!prior) return;
  }
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.id}))`);
    const current = await tx.query.importSessions.findFirst({ where: and(eq(importSessions.id, session.id), eq(importSessions.status, "collecting"), gt(importSessions.expiresAt, new Date())) });
    if (!current) return false;
    const serialized = JSON.stringify(snapshot);
    const contentHash = createHash("sha256").update(serialized).digest("hex");
    const priorCapture = await tx.query.importCapturedMessages.findFirst({ where: and(eq(importCapturedMessages.sessionId, session.id), eq(importCapturedMessages.messageId, message.id)) });
    if (priorCapture?.contentHash === contentHash) return false;
    const warnings = [...new Set([...current.warnings, ...result.warnings])].slice(-25);
    const rawSnapshot = [...current.rawSnapshot, { messageId: message.id, authorId: message.author.id, snapshot, capturedAt: new Date().toISOString() }].slice(-100);
    const now = new Date();
    await tx.insert(importCapturedMessages).values({ sessionId: session.id, messageId: message.id, snapshot, records: result.records, sourcePage: result.page, contentHash, capturedAt: now, updatedAt: now }).onConflictDoUpdate({
      target: [importCapturedMessages.sessionId, importCapturedMessages.messageId],
      set: { snapshot, records: result.records, sourcePage: result.page, contentHash, revision: sql`${importCapturedMessages.revision} + 1`, capturedAt: now, updatedAt: now },
    });
    const captures = await tx.select({ records: importCapturedMessages.records, sourcePage: importCapturedMessages.sourcePage }).from(importCapturedMessages).where(eq(importCapturedMessages.sessionId, session.id));
    const aggregate = [...new Map(captures.flatMap((capture) => capture.records).map((record) => [record.userId, record])).values()].slice(0, MAX_IMPORT_RECORDS);
    const pages = [...new Set(captures.flatMap((capture) => capture.sourcePage === null ? [] : [capture.sourcePage]))].sort((a, b) => a - b);
    const totalPages = Math.max(result.totalPages ?? 0, current.expectedPages?.count ?? 0) || undefined;
    const expectedPages = expectedPageState(source, pages, totalPages);
    await tx.delete(importEntries).where(eq(importEntries.sessionId, session.id));
    await insertEntries(tx, session.id, aggregate as ImportRecord[]);
    await tx.update(importSessions).set({ sourceMessageId: message.id, rawSnapshot, capturedPages: pages, expectedPages, warnings, recognizedMessages: current.recognizedMessages + (result.recognized ? 1 : 0), updatedAt: now }).where(and(eq(importSessions.id, session.id), eq(importSessions.status, "collecting")));
    return true;
  });
  if (changed && result.recognized && !result.records.length && session.recognizedMessages === 0 && message.channel.isSendable()) {
    await message.channel.send({ content: `I recognized ${importProviders[source].label}'s leaderboard, but it did not expose Discord member IDs with XP or level values. Try another public leaderboard format or an official export.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}
