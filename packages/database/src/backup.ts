import { createHash } from "node:crypto";
import type { LevelingBackup } from "@inochi/core";
import { db } from "./client";
import { getOrCreateGuild } from "./repository";
import { members } from "./schema";
import { eq } from "drizzle-orm";

export function backupChecksum(payload: LevelingBackup) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function buildGuildBackup(guildId: string): Promise<LevelingBackup> {
  const guild = await getOrCreateGuild(db, guildId);
  const rows = await db.select().from(members).where(eq(members.guildId, guildId));
  return {
    format: "inochi-leveling-backup", version: 1, createdAt: new Date().toISOString(), guildId,
    settings: guild.settings,
    members: rows.map((member) => ({
      userId: member.userId, xp: member.xp, weeklyXp: member.weeklyXp, messageCount: member.messageCount,
      cooldownUntil: member.cooldownUntil?.toISOString() ?? null, hidden: member.hidden,
    })),
  };
}
