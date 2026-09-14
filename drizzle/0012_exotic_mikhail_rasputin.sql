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
CREATE TABLE "telegram_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_identity_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ALTER COLUMN "telegram_identity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_pairing_codes" ADD CONSTRAINT "telegram_pairing_codes_telegram_identity_id_telegram_identities_id_fk" FOREIGN KEY ("telegram_identity_id") REFERENCES "public"."telegram_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_wallet_challenges_nonce_hash_unique" ON "app_wallet_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "app_wallet_challenges_address_expiry_idx" ON "app_wallet_challenges" USING btree ("address","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_pairing_codes_code_hash_unique" ON "telegram_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_pairing_codes_expiry_idx" ON "telegram_pairing_codes" USING btree ("expires_at");