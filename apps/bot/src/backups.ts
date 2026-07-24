import { gzipSync } from "node:zlib";
import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits, type Client, type GuildBasedChannel } from "discord.js";
import { parseGuildSettings } from "@inochi/core";
import { and, backupChecksum, backupSnapshots, buildGuildBackup, db, desc, eq, guilds, isNull, lt, sql } from "@inochi/database";
import type { GuildSettings } from "@inochi/core";
import { INOCHI_NAVY } from "./theme";
import { icon } from "./emojis";

function mostRecentSchedule(settings: GuildSettings, now: Date) {
  const scheduled = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), settings.backups.hourUtc));
  if (settings.backups.cadence === "weekly") scheduled.setUTCDate(scheduled.getUTCDate() - ((scheduled.getUTCDay() - settings.backups.weekday + 7) % 7));
  if (scheduled > now) scheduled.setUTCDate(scheduled.getUTCDate() - (settings.backups.cadence === "daily" ? 1 : 7));
  return scheduled;
}

async function channelIsManagerOnly(channel: GuildBasedChannel) {
  if (!channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return false;
  const guild = channel.guild;
  const members = await guild.members.fetch();
  return !members.some((member) => !member.user.bot && member.id !== guild.ownerId
    && !member.permissions.has([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild])
    && channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel));
}

async function createDueSnapshot(guildId: string, settings: GuildSettings, now: Date, actorId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${guildId}:scheduled-backup`}))`);
    const latest = await tx.query.backupSnapshots.findFirst({ where: and(eq(backupSnapshots.guildId, guildId), eq(backupSnapshots.trigger, "scheduled")), orderBy: [desc(backupSnapshots.createdAt)] });
    if (latest && latest.createdAt >= mostRecentSchedule(settings, now)) return null;
    const payload = await buildGuildBackup(guildId);
    const [snapshot] = await tx.insert(backupSnapshots).values({ guildId, createdBy: actorId, trigger: "scheduled", checksum: backupChecksum(payload), payload }).returning();
    return { snapshot: snapshot!, payload };
  });
}

async function deliverPending(client: Client, guildId: string, settings: GuildSettings) {
  const pending = await db.select().from(backupSnapshots).where(and(eq(backupSnapshots.guildId, guildId), eq(backupSnapshots.trigger, "scheduled"), isNull(backupSnapshots.deliveredAt))).orderBy(desc(backupSnapshots.createdAt)).limit(3);
  if (!pending.length) return;
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(settings.logging.channelId ?? "");
  if (!guild || !channel?.isTextBased() || channel.isDMBased() || !channel.isSendable() || !await channelIsManagerOnly(channel)) {
    await db.update(backupSnapshots).set({ deliveryError: "Audit channel is unavailable or visible to non-managers" }).where(and(eq(backupSnapshots.guildId, guildId), eq(backupSnapshots.trigger, "scheduled"), isNull(backupSnapshots.deliveredAt)));
    return;
  }
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) return;
  for (const snapshot of pending) {
    const payload = snapshot.payload as { members?: unknown[] };
    const compressed = gzipSync(JSON.stringify(snapshot.payload));
    const embed = new EmbedBuilder().setColor(INOCHI_NAVY).setTitle(`${icon(client, "backup")} Scheduled Inochi backup`).setDescription(`Full backup created for **${(payload.members?.length ?? 0).toLocaleString()} members**.\nChecksum: \`${snapshot.checksum.slice(0, 16)}…\``).setTimestamp(snapshot.createdAt);
    const files = compressed.length <= 8_000_000 ? [new AttachmentBuilder(compressed, { name: `inochi-${guildId}-${snapshot.createdAt.toISOString().slice(0, 10)}.json.gz` })] : [];
    if (!files.length) embed.addFields({ name: "Attachment", value: "Compressed backup exceeds 8 MB. Download it from the manager dashboard." });
    const sent = await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
    await db.update(backupSnapshots).set(sent ? { deliveredAt: new Date(), deliveryError: null } : { deliveryError: "Discord delivery failed" }).where(eq(backupSnapshots.id, snapshot.id));
  }
}

async function cycle(client: Client) {
  const now = new Date();
  for (const row of await db.select().from(guilds)) {
    try {
      const settings = parseGuildSettings(row.settings);
      await db.delete(backupSnapshots).where(and(eq(backupSnapshots.guildId, row.id), eq(backupSnapshots.trigger, "scheduled"), lt(backupSnapshots.createdAt, new Date(now.getTime() - settings.backups.retentionDays * 86_400_000))));
      if (!settings.backups.enabled || !settings.logging.channelId || !settings.logging.backups || !client.guilds.cache.has(row.id)) continue;
      await createDueSnapshot(row.id, settings, now, client.user!.id);
      await deliverPending(client, row.id, settings);
    } catch (error) {
      console.error(`Scheduled backup failed for guild ${row.id}:`, error);
    }
  }
}

export function scheduleBackups(client: Client) {
  const run = () => void cycle(client).catch(console.error);
  run();
  setInterval(run, 15 * 60_000).unref();
}
