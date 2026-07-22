ALTER TYPE "public"."backup_trigger" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "welcome_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "welcome_channel_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "welcome_message_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "setup_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "audit_logs" SET "delivered_at" = now();--> statement-breakpoint
UPDATE "api_keys" SET "expires_at" = LEAST(COALESCE("expires_at", now() + interval '7 days'), now() + interval '7 days'), "write_access" = false;--> statement-breakpoint
UPDATE "guilds" SET "setup_completed_at" = COALESCE("setup_completed_at", now()), "setup_version" = 1;
