CREATE TYPE "public"."backup_trigger" AS ENUM('manual', 'pre_restore');--> statement-breakpoint
CREATE TYPE "public"."game_type" AS ENUM('word', 'math');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('json', 'csv', 'mee6', 'arcane', 'probot', 'lurkr', 'amari', 'tatsu', 'carlbot');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('collecting', 'review', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"guild_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"created_by" text NOT NULL,
	"trigger" "backup_trigger" NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"checksum" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_votes" (
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"voted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	CONSTRAINT "external_votes_provider_user_id_pk" PRIMARY KEY("provider","user_id")
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"type" "game_type" NOT NULL,
	"answer" text NOT NULL,
	"prompt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"place_xp" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_schedules" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"rotation_index" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_schedules_guild_id_channel_id_pk" PRIMARY KEY("guild_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "game_winners" (
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"place" integer NOT NULL,
	"xp_reward" integer NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_winners_round_id_user_id_pk" PRIMARY KEY("round_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"icon" text,
	"settings" jsonb NOT NULL,
	"settings_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_entries" (
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"xp" bigint NOT NULL,
	"level" integer,
	"exact" boolean DEFAULT true NOT NULL,
	"metric" text DEFAULT 'xp' NOT NULL,
	"source_page" integer,
	CONSTRAINT "import_entries_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "import_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"created_by" text NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_status" DEFAULT 'collecting' NOT NULL,
	"channel_id" text,
	"source_message_id" text,
	"raw_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"weekly_xp" bigint DEFAULT 0 NOT NULL,
	"message_count" bigint DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"avatar" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rank_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"color_mode" text DEFAULT 'monochrome' NOT NULL,
	"color" text,
	"background_key" text,
	"leaderboard_private" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_periods" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"messages" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "xp_periods_guild_id_user_id_period_pk" PRIMARY KEY("guild_id","user_id","period")
);
--> statement-breakpoint
ALTER TABLE "backup_snapshots" ADD CONSTRAINT "backup_snapshots_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_schedules" ADD CONSTRAINT "game_schedules_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_winners" ADD CONSTRAINT "game_winners_round_id_game_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."game_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entries" ADD CONSTRAINT "import_entries_session_id_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_periods" ADD CONSTRAINT "xp_periods_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_guild_idx" ON "audit_logs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_snapshots_guild_idx" ON "backup_snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "external_votes_active_idx" ON "external_votes" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "game_rounds_active_idx" ON "game_rounds" USING btree ("guild_id","channel_id","expires_at");--> statement-breakpoint
CREATE INDEX "game_schedules_due_idx" ON "game_schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_winners_place_idx" ON "game_winners" USING btree ("round_id","place");--> statement-breakpoint
CREATE INDEX "members_leaderboard_idx" ON "members" USING btree ("guild_id","xp");--> statement-breakpoint
CREATE INDEX "xp_periods_period_idx" ON "xp_periods" USING btree ("period","guild_id");
