CREATE TYPE "public"."score_source_type" AS ENUM('QUIZ', 'WORD_SEEK', 'SCRAMBLE', 'SOCIAL_TASK', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."social_task_status" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."social_task_submission_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "community_activity_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_activity_rollups_message_count_nonnegative" CHECK ("community_activity_rollups"."message_count" >= 0),
	CONSTRAINT "community_activity_rollups_reply_count_nonnegative" CHECK ("community_activity_rollups"."reply_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "community_game_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"game_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_score_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"awarded_by_telegram_user_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"score_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_score_awards_points_positive" CHECK ("manual_score_awards"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_task_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "social_task_submission_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_telegram_user_id" bigint,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"points" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_submissions_per_player" integer,
	"cooldown_days" integer DEFAULT 0 NOT NULL,
	"status" "social_task_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_tasks_points_positive" CHECK ("social_tasks"."points" > 0),
	CONSTRAINT "social_tasks_end_after_start" CHECK ("social_tasks"."ends_at" > "social_tasks"."starts_at"),
	CONSTRAINT "social_tasks_submission_cap_positive" CHECK ("social_tasks"."max_submissions_per_player" IS NULL OR "social_tasks"."max_submissions_per_player" > 0),
	CONSTRAINT "social_tasks_cooldown_nonnegative" CHECK ("social_tasks"."cooldown_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "score_events" ALTER COLUMN "round_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "score_events" ALTER COLUMN "question_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "source_type" "score_source_type" DEFAULT 'QUIZ' NOT NULL;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "community_activity_rollups" ADD CONSTRAINT "community_activity_rollups_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_activity_rollups" ADD CONSTRAINT "community_activity_rollups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_game_configs" ADD CONSTRAINT "community_game_configs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_score_awards" ADD CONSTRAINT "manual_score_awards_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_score_awards" ADD CONSTRAINT "manual_score_awards_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_score_awards" ADD CONSTRAINT "manual_score_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_score_awards" ADD CONSTRAINT "manual_score_awards_score_event_id_score_events_id_fk" FOREIGN KEY ("score_event_id") REFERENCES "public"."score_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD CONSTRAINT "social_task_submissions_task_id_social_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."social_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_task_submissions" ADD CONSTRAINT "social_task_submissions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD CONSTRAINT "social_tasks_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_activity_rollups_community_player_bucket_unique" ON "community_activity_rollups" USING btree ("community_id","player_id","bucket_start");--> statement-breakpoint
CREATE INDEX "community_activity_rollups_community_bucket_idx" ON "community_activity_rollups" USING btree ("community_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "community_game_configs_community_game_unique" ON "community_game_configs" USING btree ("community_id","game_key");--> statement-breakpoint
CREATE INDEX "community_game_configs_community_enabled_idx" ON "community_game_configs" USING btree ("community_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_score_awards_idempotency_key_unique" ON "manual_score_awards" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_score_awards_score_event_unique" ON "manual_score_awards" USING btree ("score_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_task_submissions_task_player_reference_unique" ON "social_task_submissions" USING btree ("task_id","player_id","reference");--> statement-breakpoint
CREATE INDEX "social_task_submissions_task_status_idx" ON "social_task_submissions" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "social_tasks_community_status_window_idx" ON "social_tasks" USING btree ("community_id","status","starts_at","ends_at");