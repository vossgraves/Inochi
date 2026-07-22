import type { LevelingBackup } from "@inochi/core";
import { backupChecksum, buildGuildBackup } from "@inochi/database";

export function checksum(payload: LevelingBackup) {
  return backupChecksum(payload);
}

export async function buildBackup(guildId: string): Promise<LevelingBackup> {
  return buildGuildBackup(guildId);
}
