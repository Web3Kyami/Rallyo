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
	"telegram_identity_id" uuid,
	"target_community_id" uuid,
	"target_mode" text DEFAULT 'player' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"message_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_session_id" uuid,
	"action" text NOT NULL,
	"target_player_id" uuid,
	"target_telegram_identity_id" uuid,
	"target_wallet_identity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_identity_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_codes" ADD CONSTRAINT "app_session_codes_target_community_id_communities_id_fk" FOREIGN KEY ("target_community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_target_community_id_communities_id_fk" FOREIGN KEY ("target_community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_operator_session_id_operator_sessions_id_fk" FOREIGN KEY ("operator_session_id") REFERENCES "public"."operator_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_target_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("target_telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_target_wallet_identity_id_wallet_identities_id_fk" FOREIGN KEY ("target_wallet_identity_id") REFERENCES "public"."wallet_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pairing_codes" ADD CONSTRAINT "telegram_pairing_codes_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_session_codes_code_hash_unique" ON "app_session_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "app_session_codes_expiry_idx" ON "app_session_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_unique" ON "app_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_sessions_player_idx" ON "app_sessions" USING btree ("player_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_wallet_challenges_nonce_hash_unique" ON "app_wallet_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "app_wallet_challenges_address_expiry_idx" ON "app_wallet_challenges" USING btree ("address","expires_at");--> statement-breakpoint
CREATE INDEX "operator_audit_events_created_idx" ON "operator_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operator_audit_events_player_idx" ON "operator_audit_events" USING btree ("target_player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_sessions_token_hash_unique" ON "operator_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_sessions_expiry_idx" ON "operator_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_pairing_codes_code_hash_unique" ON "telegram_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_pairing_codes_expiry_idx" ON "telegram_pairing_codes" USING btree ("expires_at");