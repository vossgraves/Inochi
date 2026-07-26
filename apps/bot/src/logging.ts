import { panel } from "./replies";
import { MessageFlags, type Client } from "discord.js";
import { and, auditLogs, db, eq, getGuild, isNull, lt } from "@inochi/database";
import { ERROR_RED, INFO_MUTED, INOCHI_VERMILION, SUCCESS_MOSS, WARNING_KINCHA } from "./theme";
import { icon, type InochiEmoji } from "./emojis";

export type LogCategory = "commandUsage" | "levelUps" | "adminActions" | "errors" | "backups";

const logPresentation: Record<LogCategory, { emoji: InochiEmoji; color: number }> = {
  commandUsage: { emoji: "info", color: INFO_MUTED },
  levelUps: { emoji: "levelup", color: SUCCESS_MOSS },
  adminActions: { emoji: "security", color: WARNING_KINCHA },
  errors: { emoji: "error", color: ERROR_RED },
  backups: { emoji: "backup", color: INOCHI_VERMILION },
};

export async function recordAudit(guildId: string, actorId: string, action: string, metadata: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ guildId, actorId, action, metadata });
}

export async function sendGuildLog(client: Client, guildId: string, category: LogCategory, title: string, description: string) {
  const row = await getGuild(db, guildId);
  if (!row?.settings.logging.channelId || !row.settings.logging[category]) return false;
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(row.settings.logging.channelId);
  if (!channel?.isTextBased() || channel.isDMBased() || !channel.isSendable()) return false;
  const presentation = logPresentation[category];
  const container = panel(`${icon(client, presentation.emoji)} ${title}`, [description, `-# <t:${Math.floor(Date.now() / 1000)}:f>`], { color: presentation.color, dividers: true });
  await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  return true;
}

async function deliverAudit(client: Client) {
  await db.delete(auditLogs).where(lt(auditLogs.createdAt, new Date(Date.now() - 90 * 86_400_000)));
  const rows = await db.select().from(auditLogs).where(isNull(auditLogs.deliveredAt)).limit(200);
  for (const row of rows) {
    const [claimed] = await db.update(auditLogs).set({ deliveredAt: new Date() }).where(and(eq(auditLogs.id, row.id), isNull(auditLogs.deliveredAt))).returning({ id: auditLogs.id });
    if (!claimed) continue;
    const metadata = Object.entries(row.metadata).slice(0, 8).map(([key, value]) => `**${key}:** ${String(value).slice(0, 200)}`).join("\n");
    await sendGuildLog(client, row.guildId, "adminActions", "Audit event", `<@${row.actorId}> generated \`${row.action}\`.${metadata ? `\n${metadata}` : ""}`).catch(() => false);
  }
}

export function scheduleAuditDelivery(client: Client) {
  const run = () => void deliverAudit(client).catch(console.error);
  run();
  setInterval(run, 15_000).unref();
}
