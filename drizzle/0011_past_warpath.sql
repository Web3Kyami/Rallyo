CREATE TABLE "app_session_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_identity_id" uuid NOT NULL,
	"target_community_id" uuid,
	"target_mode" text DEFAULT 'player' NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"telegram_identity_id" uuid NOT NULL,
	"target_community_id" uuid,
	"target_mode" text DEFAULT 'player' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_target_community_id_communities_id_fk" FOREIGN KEY ("target_community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_target_community_id_communities_id_fk" FOREIGN KEY ("target_community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_session_codes_code_hash_unique" ON "app_session_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "app_session_codes_expiry_idx" ON "app_session_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_unique" ON "app_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_sessions_player_idx" ON "app_sessions" USING btree ("player_id","expires_at");