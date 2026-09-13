ALTER TABLE "schedules" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "last_run_at" timestamp with time zone;