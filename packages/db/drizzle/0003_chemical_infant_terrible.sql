CREATE TABLE "daily_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date_key" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"prompt" text NOT NULL,
	"response" text,
	"success_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestion_source" text DEFAULT 'heuristic' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_plans_user_date_idx" ON "daily_plans" USING btree ("user_id","date_key");