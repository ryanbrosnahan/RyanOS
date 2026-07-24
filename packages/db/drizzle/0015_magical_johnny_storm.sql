CREATE TABLE "google_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" uuid NOT NULL,
	"external_calendar_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text,
	"access_role" text DEFAULT 'reader' NOT NULL,
	"background_color" text,
	"primary" boolean DEFAULT false NOT NULL,
	"selected_for_availability" boolean DEFAULT false NOT NULL,
	"all_day_blocks_availability" boolean DEFAULT false NOT NULL,
	"write_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "google_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" uuid NOT NULL,
	"google_calendar_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"ical_uid" text,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"transparency" text DEFAULT 'opaque' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"location" text,
	"html_link" text,
	"recurring_event_id" text,
	"etag" text,
	"ryanos_owned" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_block_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date_key" text NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rule_policy_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_block_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid,
	"google_calendar_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"external_event_id" text,
	"error" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "google_calendars" ADD CONSTRAINT "google_calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_calendars" ADD CONSTRAINT "google_calendars_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_calendar_events" ADD CONSTRAINT "google_calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_calendar_events" ADD CONSTRAINT "google_calendar_events_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_calendar_events" ADD CONSTRAINT "google_calendar_events_google_calendar_id_google_calendars_id_fk" FOREIGN KEY ("google_calendar_id") REFERENCES "public"."google_calendars"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_plans" ADD CONSTRAINT "time_block_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_plans" ADD CONSTRAINT "time_block_plans_rule_policy_id_policies_id_fk" FOREIGN KEY ("rule_policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_blocks" ADD CONSTRAINT "time_block_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_blocks" ADD CONSTRAINT "time_block_blocks_plan_id_time_block_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."time_block_plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_blocks" ADD CONSTRAINT "time_block_blocks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_block_blocks" ADD CONSTRAINT "time_block_blocks_google_calendar_id_google_calendars_id_fk" FOREIGN KEY ("google_calendar_id") REFERENCES "public"."google_calendars"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendars_account_external_idx" ON "google_calendars" USING btree ("provider_account_id","external_calendar_id");
--> statement-breakpoint
CREATE INDEX "google_calendars_user_selected_idx" ON "google_calendars" USING btree ("user_id","selected_for_availability");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_events_calendar_external_idx" ON "google_calendar_events" USING btree ("google_calendar_id","external_event_id");
--> statement-breakpoint
CREATE INDEX "google_calendar_events_user_range_idx" ON "google_calendar_events" USING btree ("user_id","start_at","end_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "time_block_plans_user_date_idx" ON "time_block_plans" USING btree ("user_id","date_key") WHERE "time_block_plans"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "time_block_blocks_plan_order_idx" ON "time_block_blocks" USING btree ("plan_id","sort_order");
--> statement-breakpoint
CREATE INDEX "time_block_blocks_user_item_idx" ON "time_block_blocks" USING btree ("user_id","item_id");
