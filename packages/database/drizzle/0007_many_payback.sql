CREATE TYPE "public"."import_xp_apply_mode" AS ENUM('replace', 'missing', 'greater');--> statement-breakpoint
ALTER TYPE "public"."backup_trigger" ADD VALUE 'pre_import' BEFORE 'scheduled';--> statement-breakpoint
CREATE TABLE "import_captured_messages" (
	"session_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"source_page" integer,
	"snapshot" jsonb NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_captured_messages_session_id_message_id_pk" PRIMARY KEY("session_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "format_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "baseline_settings_revision" integer;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "settings_proposal" jsonb;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "selected_settings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "xp_apply_mode" "import_xp_apply_mode" DEFAULT 'replace' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "preview_summary" jsonb DEFAULT '{"records":0,"exact":0,"approximate":0,"invalid":0,"duplicate":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "expected_pages" jsonb;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "safety_backup_id" uuid;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD COLUMN "apply_result" jsonb;--> statement-breakpoint
ALTER TABLE "import_captured_messages" ADD CONSTRAINT "import_captured_messages_session_id_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_captured_messages_session_page_idx" ON "import_captured_messages" USING btree ("session_id","source_page");--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_safety_backup_id_backup_snapshots_id_fk" FOREIGN KEY ("safety_backup_id") REFERENCES "public"."backup_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_sessions_safety_backup_idx" ON "import_sessions" USING btree ("safety_backup_id");--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_format_version_check" CHECK ("import_sessions"."format_version" > 0);--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_baseline_revision_check" CHECK ("import_sessions"."baseline_settings_revision" is null or "import_sessions"."baseline_settings_revision" > 0);