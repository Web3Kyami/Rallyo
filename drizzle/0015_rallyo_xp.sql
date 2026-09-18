CREATE TYPE "public"."rallyo_xp_event_type" AS ENUM('DAILY_CHECKIN');--> statement-breakpoint
CREATE TABLE "rallyo_xp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"amount_xp" integer NOT NULL,
	"event_type" "rallyo_xp_event_type" NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"claim_date" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "rallyo_xp_events_amount_positive" CHECK ("rallyo_xp_events"."amount_xp" > 0),
	CONSTRAINT "rallyo_xp_events_daily_claim_date_required" CHECK ("rallyo_xp_events"."event_type" <> 'DAILY_CHECKIN' OR "rallyo_xp_events"."claim_date" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "rallyo_xp_events" ADD CONSTRAINT "rallyo_xp_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rallyo_xp_events_idempotency_key_unique" ON "rallyo_xp_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rallyo_xp_events_player_type_day_unique" ON "rallyo_xp_events" USING btree ("player_id","event_type","claim_date");--> statement-breakpoint
CREATE INDEX "rallyo_xp_events_player_idx" ON "rallyo_xp_events" USING btree ("player_id","occurred_at");