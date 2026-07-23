ALTER TABLE "import_sessions" ADD COLUMN "strategy" text;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "source_bot_id" text;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "captured_pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "recognized_messages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "import_sessions_active_lookup_idx" ON "import_sessions" USING btree ("guild_id","channel_id","source_bot_id","status","expires_at");
--> statement-breakpoint
UPDATE "import_sessions" SET "status" = 'expired', "updated_at" = now() WHERE "status" IN ('collecting', 'review');
