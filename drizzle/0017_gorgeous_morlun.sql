ALTER TABLE "manual_score_awards" DROP CONSTRAINT "manual_score_awards_points_positive";--> statement-breakpoint
ALTER TABLE "score_events" DROP CONSTRAINT "score_events_delta_positive";--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "summary_telegram_message_id" bigint;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "summary_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "outcome_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_score_awards" ADD CONSTRAINT "manual_score_awards_points_nonzero" CHECK ("manual_score_awards"."points" <> 0);--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_delta_nonzero" CHECK ("score_events"."delta" <> 0);