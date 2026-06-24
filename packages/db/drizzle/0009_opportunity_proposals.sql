CREATE INDEX "opportunities_user_status_idx" ON "opportunities" USING btree ("user_id","status","updated_at");
--> statement-breakpoint
CREATE TABLE "opportunity_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"project_slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"rating" real,
	"fit" text DEFAULT 'unknown' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"decision_by" timestamp with time zone,
	"value_estimate" text,
	"recommended_action" text,
	"rationale" text,
	"accepted_opportunity_id" uuid,
	"accepted_item_id" uuid,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_accepted_opportunity_id_opportunities_id_fk" FOREIGN KEY ("accepted_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_accepted_item_id_items_id_fk" FOREIGN KEY ("accepted_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_proposals_idempotency_idx" ON "opportunity_proposals" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "opportunity_proposals_user_status_idx" ON "opportunity_proposals" USING btree ("user_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "opportunity_proposals_source_idx" ON "opportunity_proposals" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "opportunity_proposals_project_idx" ON "opportunity_proposals" USING btree ("user_id","project_slug");
