CREATE TABLE "lottery_draw_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"status" text DEFAULT 'error' NOT NULL,
	"advertised_jackpot_dollars" bigint,
	"cash_value_dollars" bigint,
	"next_draw_at" timestamp with time zone,
	"official_cutoff_at" timestamp with time zone,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lottery_draw_snapshots_game_idx" ON "lottery_draw_snapshots" USING btree ("game_id");
--> statement-breakpoint
CREATE INDEX "lottery_draw_snapshots_freshness_idx" ON "lottery_draw_snapshots" USING btree ("status","last_success_at");
--> statement-breakpoint
CREATE TABLE "lottery_task_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"draw_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"item_id" uuid,
	"advertised_jackpot_dollars" bigint NOT NULL,
	"buy_by_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_task_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "lottery_task_alerts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lottery_task_alerts_drawing_idx" ON "lottery_task_alerts" USING btree ("user_id","game_id","draw_at");
--> statement-breakpoint
CREATE INDEX "lottery_task_alerts_user_status_idx" ON "lottery_task_alerts" USING btree ("user_id","status","buy_by_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "lottery_task_alerts_item_idx" ON "lottery_task_alerts" USING btree ("item_id");
