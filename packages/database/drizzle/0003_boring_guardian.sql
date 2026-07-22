CREATE TYPE "public"."coinflip_side" AS ENUM('heads', 'tails');--> statement-breakpoint
CREATE TYPE "public"."coinflip_status" AS ENUM('pending', 'completed', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "coinflip_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_key" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"challenger_id" text NOT NULL,
	"opponent_id" text NOT NULL,
	"wager" bigint NOT NULL,
	"challenger_side" "coinflip_side" NOT NULL,
	"outcome" "coinflip_side",
	"winner_id" text,
	"status" "coinflip_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coinflip_challenges_interaction_key_unique" UNIQUE("interaction_key")
);
--> statement-breakpoint
ALTER TABLE "coinflip_challenges" ADD CONSTRAINT "coinflip_challenges_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coinflip_challenges_due_idx" ON "coinflip_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "coinflip_challenges_guild_created_idx" ON "coinflip_challenges" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "coinflip_challenges_challenger_idx" ON "coinflip_challenges" USING btree ("guild_id","challenger_id","created_at");--> statement-breakpoint
CREATE INDEX "coinflip_challenges_opponent_idx" ON "coinflip_challenges" USING btree ("guild_id","opponent_id","created_at");--> statement-breakpoint
INSERT INTO "audit_logs" ("guild_id", "actor_id", "action", "metadata")
SELECT
	"id",
	'system',
	'progression.migrate-lurkr',
	jsonb_build_object(
		'previousSettings', "settings"
	)
FROM "guilds";--> statement-breakpoint
UPDATE "guilds"
SET
	"settings" = "settings"
		|| '{"gain":{"min":15,"max":40,"cooldownSeconds":60},"curve":{"constant":150,"cubic":0,"quadratic":50,"linear":-100,"rounding":1,"maxLevel":1000}}'::jsonb
		|| jsonb_build_object(
			'multipliers', COALESCE("settings"->'multipliers', '{}'::jsonb) || '{"global":1}'::jsonb
		)
		|| jsonb_build_object(
			'games', COALESCE("settings"->'games', '{}'::jsonb)
				|| jsonb_build_object(
					'wordRace', COALESCE("settings"#>'{games,wordRace}', '{}'::jsonb) || '{"answerSeconds":120}'::jsonb,
					'mathRace', COALESCE("settings"#>'{games,mathRace}', '{}'::jsonb) || '{"answerSeconds":120}'::jsonb
				)
		),
	"settings_revision" = "settings_revision" + 1,
	"updated_at" = now();
