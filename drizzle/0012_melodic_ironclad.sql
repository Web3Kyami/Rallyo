CREATE TYPE "public"."question_presentation_type" AS ENUM('TEXT', 'MCQ', 'IMAGE_IDENTIFY', 'IMAGE_CLUE', 'MATH', 'PROGRESSIVE_CLUE');--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "presentation_type" "question_presentation_type" DEFAULT 'TEXT' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "hints" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_file_id" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_asset_ref" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_source" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_credit" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_alt" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "media_spoiler" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "difficulty" text DEFAULT 'MEDIUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "scramble_rounds" ADD COLUMN "difficulty" text DEFAULT 'MEDIUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD COLUMN "difficulty" text DEFAULT 'MEDIUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_seek_sessions" ADD COLUMN "accepted_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "word_seek_words" ADD COLUMN "category" text DEFAULT 'Vocabulary' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_seek_words" ADD COLUMN "difficulty" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_seek_words" ADD COLUMN "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;