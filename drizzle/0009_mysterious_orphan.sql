CREATE TYPE "public"."scramble_round_status" AS ENUM('LIVE', 'WON', 'TIMED_OUT', 'STOPPED');--> statement-breakpoint
CREATE TYPE "public"."scramble_source" AS ENUM('GENERAL', 'PROJECT_BRAIN');--> statement-breakpoint
CREATE TYPE "public"."word_seek_session_status" AS ENUM('LIVE', 'WON', 'TIMED_OUT', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."word_seek_source_type" AS ENUM('GENERAL', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."word_seek_word_status" AS ENUM('DRAFT', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "scramble_guesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_input_id" text NOT NULL,
	"raw_answer" text NOT NULL,
	"normalized_answer" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_correct" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scramble_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"source" "scramble_source" NOT NULL,
	"source_term_id" text,
	"term" text NOT NULL,
	"normalized_answer" text NOT NULL,
	"scrambled_term" text NOT NULL,
	"category" text NOT NULL,
	"status" "scramble_round_status" DEFAULT 'LIVE' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	"points" integer NOT NULL,
	"points_remaining" integer NOT NULL,
	"hints_enabled" boolean DEFAULT true NOT NULL,
	"max_hints" integer DEFAULT 2 NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"hint_timing_seconds" jsonb NOT NULL,
	"point_reductions" jsonb NOT NULL,
	"revealed_positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_player_id" uuid,
	"telegram_message_id" bigint,
	"outcome_notified_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scramble_rounds_points_positive" CHECK ("scramble_rounds"."points" > 0),
	CONSTRAINT "scramble_rounds_points_remaining_positive" CHECK ("scramble_rounds"."points_remaining" > 0),
	CONSTRAINT "scramble_rounds_max_hints_nonnegative" CHECK ("scramble_rounds"."max_hints" >= 0),
	CONSTRAINT "scramble_rounds_hint_count_nonnegative" CHECK ("scramble_rounds"."hint_count" >= 0),
	CONSTRAINT "scramble_rounds_hint_count_bounded" CHECK ("scramble_rounds"."hint_count" <= "scramble_rounds"."max_hints"),
	CONSTRAINT "scramble_rounds_lock_after_start" CHECK ("scramble_rounds"."locks_at" > "scramble_rounds"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "word_seek_guesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_input_id" text NOT NULL,
	"raw_guess" text NOT NULL,
	"normalized_guess" text NOT NULL,
	"feedback" text,
	"is_correct" boolean NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_seek_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"target_word" text NOT NULL,
	"word_length" integer NOT NULL,
	"source_type" "word_seek_source_type" NOT NULL,
	"source_id" uuid,
	"clue" text,
	"points" integer NOT NULL,
	"max_guesses" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "word_seek_session_status" DEFAULT 'LIVE' NOT NULL,
	"active_key" text,
	"winner_player_id" uuid,
	"winner_telegram_input_id" text,
	"telegram_message_id" bigint,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_seek_sessions_length_valid" CHECK ("word_seek_sessions"."word_length" >= 4 AND "word_seek_sessions"."word_length" <= 6),
	CONSTRAINT "word_seek_sessions_points_positive" CHECK ("word_seek_sessions"."points" > 0),
	CONSTRAINT "word_seek_sessions_max_guesses_positive" CHECK ("word_seek_sessions"."max_guesses" > 0),
	CONSTRAINT "word_seek_sessions_end_after_start" CHECK ("word_seek_sessions"."ends_at" > "word_seek_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "word_seek_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"word" text NOT NULL,
	"word_length" integer NOT NULL,
	"clue" text,
	"source_ref" text,
	"status" "word_seek_word_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_seek_words_length_valid" CHECK ("word_seek_words"."word_length" >= 4 AND "word_seek_words"."word_length" <= 6)
);
--> statement-breakpoint
ALTER TABLE "scramble_guesses" ADD CONSTRAINT "scramble_guesses_round_id_scramble_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."scramble_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_guesses" ADD CONSTRAINT "scramble_guesses_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_rounds" ADD CONSTRAINT "scramble_rounds_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_rounds" ADD CONSTRAINT "scramble_rounds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_rounds" ADD CONSTRAINT "scramble_rounds_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_guesses" ADD CONSTRAINT "word_seek_guesses_session_id_word_seek_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."word_seek_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_guesses" ADD CONSTRAINT "word_seek_guesses_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD CONSTRAINT "word_seek_sessions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD CONSTRAINT "word_seek_sessions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD CONSTRAINT "word_seek_sessions_source_id_word_seek_words_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."word_seek_words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD CONSTRAINT "word_seek_sessions_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_seek_words" ADD CONSTRAINT "word_seek_words_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scramble_guesses_telegram_input_unique" ON "scramble_guesses" USING btree ("telegram_input_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scramble_guesses_round_player_answer_unique" ON "scramble_guesses" USING btree ("round_id","player_id","normalized_answer");--> statement-breakpoint
CREATE INDEX "scramble_rounds_community_status_idx" ON "scramble_rounds" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "scramble_rounds_due_idx" ON "scramble_rounds" USING btree ("status","locks_at");--> statement-breakpoint
CREATE INDEX "scramble_rounds_community_created_idx" ON "scramble_rounds" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scramble_rounds_one_live_per_community_unique" ON "scramble_rounds" USING btree ("community_id") WHERE "scramble_rounds"."status" = 'LIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "word_seek_guesses_session_guess_unique" ON "word_seek_guesses" USING btree ("session_id","normalized_guess");--> statement-breakpoint
CREATE UNIQUE INDEX "word_seek_guesses_telegram_input_unique" ON "word_seek_guesses" USING btree ("telegram_input_id");--> statement-breakpoint
CREATE INDEX "word_seek_guesses_session_submitted_idx" ON "word_seek_guesses" USING btree ("session_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "word_seek_sessions_active_key_unique" ON "word_seek_sessions" USING btree ("active_key");--> statement-breakpoint
CREATE INDEX "word_seek_sessions_community_status_idx" ON "word_seek_sessions" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "word_seek_sessions_timeout_idx" ON "word_seek_sessions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "word_seek_words_community_word_unique" ON "word_seek_words" USING btree ("community_id","word");--> statement-breakpoint
CREATE INDEX "word_seek_words_community_status_length_idx" ON "word_seek_words" USING btree ("community_id","status","word_length");
