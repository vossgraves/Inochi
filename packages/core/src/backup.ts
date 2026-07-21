import { z } from "zod";
import { guildSettingsSchema } from "./settings";

const memberBackupSchema = z.object({
  userId: z.string().regex(/^\d{16,20}$/),
  xp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  weeklyXp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  messageCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cooldownUntil: z.string().datetime().nullable(),
  hidden: z.boolean(),
});

export const levelingBackupSchema = z.object({
  format: z.literal("inochi-leveling-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  guildId: z.string().regex(/^\d{16,20}$/),
  settings: guildSettingsSchema,
  members: z.array(memberBackupSchema).max(1_000_000),
});

export type LevelingBackup = z.infer<typeof levelingBackupSchema>;
