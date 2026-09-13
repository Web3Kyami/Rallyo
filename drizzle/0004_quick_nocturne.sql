CREATE TABLE "admin_wizard_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"community_id" uuid NOT NULL,
	"state" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_wizard_sessions" ADD CONSTRAINT "admin_wizard_sessions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_wizard_sessions_user_community_unique" ON "admin_wizard_sessions" USING btree ("telegram_user_id","community_id");--> statement-breakpoint
CREATE INDEX "admin_wizard_sessions_expiry_idx" ON "admin_wizard_sessions" USING btree ("expires_at");