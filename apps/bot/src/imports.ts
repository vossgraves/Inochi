import type { Message } from "discord.js";
import { and, db, eq, gt, importEntries, importSessions, sql } from "@inochi/database";
import { parsePublicLeaderboardMessage, sourceBotIds } from "@inochi/importers";

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
  for (const record of records) {
    await db.insert(importEntries).values({ sessionId: session.id, ...record }).onConflictDoUpdate({
      target: [importEntries.sessionId, importEntries.userId],
      set: { xp: record.xp, level: record.level, exact: record.exact, sourcePage: record.page },
    });
  }
  await db.update(importSessions).set({ sourceMessageId: message.id, rawSnapshot: sql`${importSessions.rawSnapshot} || ${JSON.stringify([{ messageId: message.id, text, capturedAt: new Date().toISOString() }])}::jsonb`, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
}
