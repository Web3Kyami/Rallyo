CREATE TYPE "public"."community_status" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_type" AS ENUM('PASTED_TEXT', 'MARKDOWN', 'FAQ');--> statement-breakpoint
CREATE TYPE "public"."question_mode" AS ENUM('QUICK', 'FIRST_CORRECT', 'CLUE');--> statement-breakpoint
CREATE TYPE "public"."question_scope" AS ENUM('GLOBAL', 'COMMUNITY');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('DEFAULT', 'PROJECT_AI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('DRAFT', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."quiz_status" AS ENUM('DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."reward_status" AS ENUM('ELIGIBLE', 'CLAIMING', 'SENT', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('DRAFT', 'SCHEDULED', 'LIVE', 'LOCKED', 'SCORED', 'CLOSED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"player_id" uuid,
	"community_id" uuid,
	"round_id" uuid,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_input_id" text NOT NULL,
	"raw_answer" text,
	"normalized_answer" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_correct" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "community_status" DEFAULT 'ACTIVE' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"automatic_rounds_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours" jsonb,
	"question_cooldown_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_question_cooldown_nonnegative" CHECK ("communities"."question_cooldown_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "community_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"type" "knowledge_source_type" NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"checksum" text NOT NULL,
	"status" "knowledge_source_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "question_scope" NOT NULL,
	"community_id" uuid,
	"source" "question_source" NOT NULL,
	"mode" "question_mode" NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"correct_answer" text NOT NULL,
	"accepted_answers" jsonb NOT NULL,
	"clue_data" jsonb,
	"explanation" text,
	"source_refs" jsonb,
	"base_points" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "question_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_base_points_positive" CHECK ("questions"."base_points" > 0),
	CONSTRAINT "questions_scope_community_consistency" CHECK (("questions"."scope" = 'GLOBAL' AND "questions"."community_id" IS NULL) OR ("questions"."scope" = 'COMMUNITY' AND "questions"."community_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"quiz_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"points_override" integer,
	CONSTRAINT "quiz_questions_sequence_positive" CHECK ("quiz_questions"."sequence" > 0),
	CONSTRAINT "quiz_questions_points_override_positive" CHECK ("quiz_questions"."points_override" IS NULL OR "quiz_questions"."points_override" > 0)
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid,
	"name" text NOT NULL,
	"source_policy" text NOT NULL,
	"question_count" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"per_question_seconds" integer NOT NULL,
	"status" "quiz_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quizzes_question_count_positive" CHECK ("quizzes"."question_count" > 0),
	CONSTRAINT "quizzes_question_seconds_positive" CHECK ("quizzes"."per_question_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"amount_luna" bigint NOT NULL,
	"status" "reward_status" DEFAULT 'ELIGIBLE' NOT NULL,
	"transaction_hash" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_entitlements_rank_positive" CHECK ("reward_entitlements"."rank" > 0),
	CONSTRAINT "reward_entitlements_amount_positive" CHECK ("reward_entitlements"."amount_luna" > 0)
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"quiz_id" uuid,
	"question_id" uuid NOT NULL,
	"state" "round_status" DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	"scored_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rounds_lock_after_start" CHECK ("rounds"."locks_at" > "rounds"."starts_at"),
	CONSTRAINT "rounds_version_nonnegative" CHECK ("rounds"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_lock_version_nonnegative" CHECK ("schedules"."lock_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_events_delta_positive" CHECK ("score_events"."delta" > 0)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "season_status" DEFAULT 'DRAFT' NOT NULL,
	"reward_pool_luna" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_end_after_start" CHECK ("seasons"."ends_at" > "seasons"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "telegram_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"username" text,
	"display_name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"telegram_update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"address" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"message_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"address" text NOT NULL,
	"public_key" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_identity_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_admins" ADD CONSTRAINT "community_admins_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_usages" ADD CONSTRAINT "question_usages_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_usages" ADD CONSTRAINT "question_usages_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_usages" ADD CONSTRAINT "question_usages_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_identities" ADD CONSTRAINT "telegram_identities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_identities" ADD CONSTRAINT "wallet_identities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_link_codes" ADD CONSTRAINT "wallet_link_codes_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_type_created_idx" ON "analytics_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_round_player_unique" ON "answers" USING btree ("round_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_telegram_input_unique" ON "answers" USING btree ("telegram_input_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communities_telegram_chat_id_unique" ON "communities" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communities_slug_unique" ON "communities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "community_admins_community_telegram_user_unique" ON "community_admins" USING btree ("community_id","telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_community_checksum_unique" ON "knowledge_sources" USING btree ("community_id","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "question_usages_question_round_unique" ON "question_usages" USING btree ("question_id","round_id");--> statement-breakpoint
CREATE INDEX "question_usages_cooldown_idx" ON "question_usages" USING btree ("community_id","question_id","used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_fingerprint_unique" ON "questions" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "questions_scheduler_selection_idx" ON "questions" USING btree ("status","scope","community_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_questions_quiz_sequence_unique" ON "quiz_questions" USING btree ("quiz_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_questions_quiz_question_unique" ON "quiz_questions" USING btree ("quiz_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_entitlements_idempotency_key_unique" ON "reward_entitlements" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_entitlements_season_player_unique" ON "reward_entitlements" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE INDEX "rounds_community_state_idx" ON "rounds" USING btree ("community_id","state");--> statement-breakpoint
CREATE INDEX "rounds_live_lookup_idx" ON "rounds" USING btree ("state","locks_at");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "score_events_idempotency_key_unique" ON "score_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "score_events_round_player_unique" ON "score_events" USING btree ("round_id","player_id");--> statement-breakpoint
CREATE INDEX "score_events_season_leaderboard_idx" ON "score_events" USING btree ("community_id","season_id","delta");--> statement-breakpoint
CREATE INDEX "score_events_player_xp_idx" ON "score_events" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "seasons_community_status_idx" ON "seasons" USING btree ("community_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_identities_telegram_user_id_unique" ON "telegram_identities" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_challenges_nonce_hash_unique" ON "wallet_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "wallet_challenges_player_expiry_idx" ON "wallet_challenges" USING btree ("player_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_identities_address_unique" ON "wallet_identities" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_link_codes_code_hash_unique" ON "wallet_link_codes" USING btree ("code_hash");