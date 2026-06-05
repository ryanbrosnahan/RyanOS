CREATE TABLE "email_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_account_id" uuid,
	"idempotency_key" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"draft_reply_text" text,
	"rationale" text,
	"confidence" integer,
	"accepted_item_id" uuid,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_action_proposals" ADD CONSTRAINT "email_action_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_action_proposals" ADD CONSTRAINT "email_action_proposals_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_action_proposals" ADD CONSTRAINT "email_action_proposals_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_action_proposals" ADD CONSTRAINT "email_action_proposals_accepted_item_id_items_id_fk" FOREIGN KEY ("accepted_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_sources_provider_external_idx" ON "external_sources" USING btree ("provider","provider_account_id","external_id");--> statement-breakpoint
CREATE INDEX "external_sources_user_provider_occurred_idx" ON "external_sources" USING btree ("user_id","provider","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_proposals_idempotency_idx" ON "email_action_proposals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_action_proposals_user_status_idx" ON "email_action_proposals" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "email_action_proposals_source_idx" ON "email_action_proposals" USING btree ("source_id");
