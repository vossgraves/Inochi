CREATE TABLE "persistent_leaderboards" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_rendered_at" timestamp with time zone,
	"content_hash" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persistent_leaderboards" ADD CONSTRAINT "persistent_leaderboards_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persistent_leaderboards_due_idx" ON "persistent_leaderboards" USING btree ("dirty","due_at","lease_until");