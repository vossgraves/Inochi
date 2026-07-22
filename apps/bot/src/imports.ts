import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type Message, type StringSelectMenuInteraction } from "discord.js";
import { and, applyImport, count, db, eq, gt, importEntries, importSessions, sql } from "@inochi/database";
import { fetchMee6, parsePublicLeaderboardMessage, sourceBotIds } from "@inochi/importers";
import { xpForLevel } from "@inochi/core";
import { getOrCreateGuild } from "@inochi/database";
import { INOCHI_NAVY } from "./theme";

const sources = ["mee6", "probot", "arcane", "amari", "lurkr", "carlbot"] as const;
type Source = typeof sources[number];
type ImportComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;

type ImportRecord = { userId: string; xp: number; level?: number; exact?: boolean; metric?: string; page?: number };

async function createSession(input: { guildId: string; channelId: string; createdBy: string; source: Source; status?: "collecting" | "review"; expiresAt: Date }, records: ImportRecord[] = []) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.guildId}:${input.channelId}:${input.source}:import`}))`);
    const active = await tx.query.importSessions.findFirst({
      where: and(eq(importSessions.guildId, input.guildId), eq(importSessions.channelId, input.channelId), eq(importSessions.source, input.source), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, new Date())),
    });
    if (active) throw new Error("An import from this source is already active in this channel");
    const [session] = await tx.insert(importSessions).values(input).returning();
    if (!session) throw new Error("Could not create the import session");
    for (const record of records) await tx.insert(importEntries).values({ sessionId: session.id, ...record, sourcePage: record.page }).onConflictDoNothing();
    return session;
  });
}

function panel(source?: Source, session?: typeof importSessions.$inferSelect, details?: string, confirm = false) {
  const selected = session?.source as Source | undefined ?? source;
  const status = session ? `**Session:** \`${session.id}\`\n**Source:** ${session.source}\n**Status:** ${session.status}\nExpires <t:${Math.floor(session.expiresAt.getTime() / 1000)}:R>` : `Choose a source, then select **Start**. Public leaderboard messages are captured for 30 minutes.`;
  const select = new StringSelectMenuBuilder().setCustomId("import:source:new").setPlaceholder("Choose the leveling bot").addOptions(
    ...sources.map((value) => ({ label: value === "mee6" ? "MEE6" : value, value, default: value === selected })),
  ).setDisabled(Boolean(session));
  const id = session?.id ?? selected ?? "none";
  const active = session && (session.status === "collecting" || session.status === "review");
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`import:start:${id}`).setLabel("Start").setStyle(ButtonStyle.Primary).setDisabled(Boolean(session) || !selected),
    new ButtonBuilder().setCustomId(`import:review:${id}`).setLabel("Review").setStyle(ButtonStyle.Secondary).setDisabled(!active),
    new ButtonBuilder().setCustomId(`import:apply:${id}${confirm ? ":confirm" : ""}`).setLabel(confirm ? "Confirm apply" : "Apply").setStyle(confirm ? ButtonStyle.Danger : ButtonStyle.Primary).setDisabled(session?.status !== "review"),
    new ButtonBuilder().setCustomId(`import:stop:${id}`).setLabel("Stop").setStyle(ButtonStyle.Danger).setDisabled(!active),
  );
  return new ContainerBuilder().setAccentColor(INOCHI_NAVY)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## XP import\n${status}${details ? `\n\n${details}` : ""}`))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
    .addActionRowComponents(buttons);
}

export async function showImportPanel(interaction: ChatInputCommandInteraction) {
  const source = interaction.options.getString("source") as Source | null;
  await interaction.reply({ components: [panel(source ?? undefined)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

export async function showImportPanelMessage(message: Message<true>, source?: string) {
  if (source && !sources.includes(source as Source)) throw new Error(`Source must be one of: ${sources.join(", ")}`);
  await message.reply({ components: [panel(source as Source | undefined)], flags: MessageFlags.IsComponentsV2 });
}

async function sessionFor(interaction: ImportComponentInteraction, id: string) {
  if (!interaction.guildId) throw new Error("This import only works in a server");
  const session = await db.query.importSessions.findFirst({ where: and(eq(importSessions.id, id), eq(importSessions.guildId, interaction.guildId)) });
  if (!session) throw new Error("This import session no longer exists");
  if (session.expiresAt <= new Date()) throw new Error("This import session expired");
  if (session.createdBy !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Only the initiator or a server manager can control this import");
  return session;
}

export async function handleImportComponent(interaction: ImportComponentInteraction) {
  if (!interaction.customId.startsWith("import:")) return false;
  if (!interaction.inGuild() || !interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("Manage Server permission is required");
  const [, action, id] = interaction.customId.split(":");
  await interaction.deferUpdate();
  if (action === "source" && interaction.isStringSelectMenu()) {
    await interaction.editReply({ components: [panel(interaction.values[0] as Source)] });
    return true;
  }
  if (action === "start") {
    if (!sources.includes(id as Source)) throw new Error("Choose an import source first");
    const source = id as Source;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    if (source === "mee6") {
      const records = await fetchMee6(interaction.guildId);
      const session = await createSession({ guildId: interaction.guildId, createdBy: interaction.user.id, source, status: "review", channelId: interaction.channelId, expiresAt }, records);
      await interaction.editReply({ components: [panel(undefined, session, `Loaded **${records.length.toLocaleString()}** records. Review them before applying.`)] });
      return true;
    }
    const session = await createSession({ guildId: interaction.guildId, createdBy: interaction.user.id, source, channelId: interaction.channelId, expiresAt });
    await interaction.editReply({ components: [panel(undefined, session, `Run ${source}'s public leaderboard command in this channel and visit every page.`)] });
    return true;
  }
  if (!id) throw new Error("Invalid import control");
  const session = await sessionFor(interaction, id);
  if (action === "stop") {
    const updatedAt = new Date();
    const [stopped] = await db.update(importSessions).set({ status: "cancelled", updatedAt }).where(and(eq(importSessions.id, session.id), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, updatedAt))).returning();
    if (!stopped) throw new Error("This import session is no longer active");
    await interaction.editReply({ components: [panel(undefined, stopped, "Import stopped.")] });
    return true;
  }
  const [total] = await db.select({ value: count() }).from(importEntries).where(eq(importEntries.sessionId, session.id));
  const [approximate] = await db.select({ value: count() }).from(importEntries).where(and(eq(importEntries.sessionId, session.id), eq(importEntries.exact, false)));
  if (action === "review") {
    const updatedAt = new Date();
    const [reviewed] = await db.update(importSessions).set({ status: "review", updatedAt }).where(and(eq(importSessions.id, session.id), sql`${importSessions.status} in ('collecting', 'review')`, gt(importSessions.expiresAt, updatedAt))).returning();
    if (!reviewed) throw new Error("This import session is no longer active");
    await interaction.editReply({ components: [panel(undefined, reviewed, `Captured **${total?.value ?? 0}** members. **${approximate?.value ?? 0}** entries are level-only estimates.`)] });
    return true;
  }
  if (action === "apply" && !interaction.customId.endsWith(":confirm")) {
    if (session.status !== "review") throw new Error("Review the import before applying it");
    const confirmed = panel(undefined, session, `This replaces XP for **${total?.value ?? 0}** matching members. Select **Confirm apply** to continue.`, true);
    await interaction.editReply({ components: [confirmed] });
    return true;
  }
  if (action === "apply") {
    if (session.status !== "review") throw new Error("Review the import before applying it");
    const guild = await getOrCreateGuild(db, interaction.guildId, interaction.guild.name);
    const guildMembers = await interaction.guild.members.fetch();
    const imported = await applyImport(db, { sessionId: session.id, actorId: interaction.user.id, approximateXp: (level) => xpForLevel(level, guild.settings), includeUser: (userId) => guildMembers.has(userId) });
    await interaction.editReply({ components: [panel(undefined, { ...session, status: "completed", updatedAt: new Date() }, `Applied **${imported.toLocaleString()}** member records.`)] });
    return true;
  }
  throw new Error("Unknown import action");
}

export async function captureImportMessage(message: Message) {
  if (!message.guild || !message.author.bot) return;
  const source = Object.entries(sourceBotIds).find(([, id]) => id === message.author.id)?.[0];
  if (!source) return;
  const session = await db.query.importSessions.findFirst({
    where: and(eq(importSessions.guildId, message.guild.id), eq(importSessions.channelId, message.channel.id), eq(importSessions.source, source as typeof importSessions.source.enumValues[number]), eq(importSessions.status, "collecting"), gt(importSessions.expiresAt, new Date())),
  });
  if (!session) return;
  const text = [message.content, ...message.embeds.flatMap((embed) => [embed.title, embed.description, ...embed.fields.flatMap((field) => [field.name, field.value])])].filter(Boolean).join("\n");
  const pageMatch = text.match(/page\s+(\d+)/i);
  const records = parsePublicLeaderboardMessage(text, pageMatch ? Number(pageMatch[1]) : undefined);
  for (const record of records) await db.insert(importEntries).values({ sessionId: session.id, ...record }).onConflictDoUpdate({
    target: [importEntries.sessionId, importEntries.userId], set: { xp: record.xp, level: record.level, exact: record.exact, sourcePage: record.page },
  });
  await db.update(importSessions).set({ sourceMessageId: message.id, rawSnapshot: sql`${importSessions.rawSnapshot} || ${JSON.stringify([{ messageId: message.id, text, capturedAt: new Date().toISOString() }])}::jsonb`, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
}
