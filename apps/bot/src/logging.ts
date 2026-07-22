import { EmbedBuilder, type Client } from "discord.js";
import { and, auditLogs, db, eq, getGuild, isNull, lt } from "@inochi/database";
import { INOCHI_NAVY } from "./theme";

export type LogCategory = "commandUsage" | "levelUps" | "adminActions" | "errors" | "backups";

export async function recordAudit(guildId: string, actorId: string, action: string, metadata: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ guildId, actorId, action, metadata });
}

export async function sendGuildLog(client: Client, guildId: string, category: LogCategory, title: string, description: string) {
  const row = await getGuild(db, guildId);
  if (!row?.settings.logging.channelId || !row.settings.logging[category]) return false;
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(row.settings.logging.channelId);
  if (!channel?.isTextBased() || channel.isDMBased() || !channel.isSendable()) return false;
  await channel.send({ embeds: [new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(title).setDescription(description).setTimestamp()], allowedMentions: { parse: [] } });
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
