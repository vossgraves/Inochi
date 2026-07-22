ALTER TABLE "backup_snapshots" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_snapshots" ADD COLUMN "delivery_error" text;