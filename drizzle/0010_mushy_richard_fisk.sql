CREATE TABLE "social_task_submission_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"community_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_task_submission_sessions" ADD CONSTRAINT "social_task_submission_sessions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_task_submission_sessions" ADD CONSTRAINT "social_task_submission_sessions_task_id_social_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."social_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_task_submission_sessions_user_community_unique" ON "social_task_submission_sessions" USING btree ("telegram_user_id","community_id");--> statement-breakpoint
CREATE INDEX "social_task_submission_sessions_expiry_idx" ON "social_task_submission_sessions" USING btree ("expires_at");