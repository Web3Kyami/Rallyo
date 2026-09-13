ALTER TABLE "rounds" ADD COLUMN "presentation" text;
--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "project_quiz_config" jsonb;
--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_project_quiz_presentation_valid" CHECK ("rounds"."presentation" IS NULL OR "rounds"."presentation" IN ('typed', 'multiple_choice'));
