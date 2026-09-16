CREATE TYPE "public"."social_proof_type" AS ENUM('URL', 'SCREENSHOT', 'URL_SCREENSHOT');--> statement-breakpoint
CREATE TYPE "public"."social_task_action" AS ENUM('POST', 'COMMENT_REPLY', 'SHARE_REPOST', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."social_task_platform" AS ENUM('X', 'INSTAGRAM', 'TIKTOK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."social_task_type" AS ENUM('RECURRING', 'CAMPAIGN');--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "winner_count" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "proof_type" "social_proof_type" DEFAULT 'URL' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_file_id" text;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_file_unique_id" text;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_file_name" text;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_mime_type" text;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_file_size" integer;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_width" integer;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "screenshot_height" integer;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD COLUMN "claimed_handle" text;--> statement-breakpoint
ALTER TABLE "social_task_submission_sessions" ADD COLUMN "pending_url" text;--> statement-breakpoint
ALTER TABLE "social_task_submission_sessions" ADD COLUMN "pending_handle" text;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "task_type" "social_task_type" DEFAULT 'RECURRING' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "platform" "social_task_platform" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "action" "social_task_action" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "target_url" text;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "proof_type" "social_proof_type" DEFAULT 'URL' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "requires_handle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "max_approved_submissions_per_player_per_day" integer;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD COLUMN "completion_cap_per_player" integer;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_winner_count_positive" CHECK ("seasons"."winner_count" > 0);--> statement-breakpoint
ALTER TABLE "social_tasks" ADD CONSTRAINT "social_tasks_daily_approved_cap_positive" CHECK ("social_tasks"."max_approved_submissions_per_player_per_day" IS NULL OR "social_tasks"."max_approved_submissions_per_player_per_day" > 0);--> statement-breakpoint
ALTER TABLE "social_tasks" ADD CONSTRAINT "social_tasks_completion_cap_positive" CHECK ("social_tasks"."completion_cap_per_player" IS NULL OR "social_tasks"."completion_cap_per_player" > 0);
