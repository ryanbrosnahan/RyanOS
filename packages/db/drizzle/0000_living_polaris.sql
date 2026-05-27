CREATE TYPE "public"."item_kind" AS ENUM('task', 'reminder', 'decision', 'note', 'waiting', 'habit', 'opportunity_action', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('open', 'active', 'waiting', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."object_status" AS ENUM('active', 'paused', 'archived', 'disabled', 'proposed', 'validated', 'enabled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."policy_type" AS ENUM('notification', 'planning', 'confirmation', 'retention', 'permission', 'other');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."recurrence_event_type" AS ENUM('completed', 'skipped', 'missed', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."recurrence_type" AS ENUM('completion_based', 'fixed_schedule', 'minimum_interval', 'target_frequency', 'opportunistic');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"source_message_id" uuid,
	"tool_name" text,
	"capability_id" text,
	"skill_id" text,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" text NOT NULL,
	"provider" text NOT NULL,
	"description" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" uuid,
	"capability_id" uuid NOT NULL,
	"operation_name" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"source_message_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"mutating" boolean DEFAULT false NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"requires_auth" boolean DEFAULT true NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"external_id" text,
	"url" text,
	"title" text,
	"summary" text,
	"occurred_at" timestamp with time zone,
	"retention_class" text DEFAULT 'summary' NOT NULL,
	"raw_payload_expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_message_id" uuid,
	"idempotency_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid,
	"project_id" uuid,
	"kind" "item_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"status" "item_status" DEFAULT 'open' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"start_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"estimate_minutes" integer,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"direction" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"sender_display_name" text,
	"reply_to_message_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid,
	"project_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'tracking' NOT NULL,
	"fit" text DEFAULT 'unknown' NOT NULL,
	"due_at" timestamp with time zone,
	"decision_by" timestamp with time zone,
	"value_estimate" text,
	"next_action_item_id" uuid,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "policy_type" NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"review_after" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text,
	"display_name" text,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurrence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recurrence_policy_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"event_type" "recurrence_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_message_id" uuid,
	"note" text,
	"idempotency_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurrence_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"type" "recurrence_type" NOT NULL,
	"interval_days" integer,
	"minimum_interval_days" integer,
	"cron" text,
	"target_count" integer,
	"target_window_days" integer,
	"preferred_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_time" text,
	"reset_from_completion" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurrence_state" (
	"recurrence_policy_id" uuid PRIMARY KEY NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"staleness_score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"message" text NOT NULL,
	"trigger_at" timestamp with time zone,
	"cron" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"target_type" text,
	"target_id" uuid,
	"provider" text,
	"provider_chat_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" uuid,
	"kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"key_version" text NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_chat_id" text NOT NULL,
	"provider_thread_id" text,
	"title" text,
	"last_message_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_capability_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"operation_name" text,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"version" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"package_path" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_operations" ADD CONSTRAINT "capability_operations_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_next_action_item_id_items_id_fk" FOREIGN KEY ("next_action_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_events" ADD CONSTRAINT "recurrence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_events" ADD CONSTRAINT "recurrence_events_recurrence_policy_id_recurrence_policies_id_fk" FOREIGN KEY ("recurrence_policy_id") REFERENCES "public"."recurrence_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_events" ADD CONSTRAINT "recurrence_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_events" ADD CONSTRAINT "recurrence_events_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_policies" ADD CONSTRAINT "recurrence_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_policies" ADD CONSTRAINT "recurrence_policies_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_state" ADD CONSTRAINT "recurrence_state_recurrence_policy_id_recurrence_policies_id_fk" FOREIGN KEY ("recurrence_policy_id") REFERENCES "public"."recurrence_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_records" ADD CONSTRAINT "secret_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_records" ADD CONSTRAINT "secret_records_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_capability_requirements" ADD CONSTRAINT "skill_capability_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_capability_requirements" ADD CONSTRAINT "skill_capability_requirements_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_capability_id_idx" ON "capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_operations_name_idx" ON "capability_operations" USING btree ("capability_id","name");--> statement-breakpoint
CREATE INDEX "item_events_item_occurred_idx" ON "item_events" USING btree ("item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_events_idempotency_idx" ON "item_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "items_status_due_idx" ON "items" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "items_project_status_idx" ON "items" USING btree ("user_id","project_id","status");--> statement-breakpoint
CREATE INDEX "messages_session_occurred_idx" ON "messages" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_accounts_external_idx" ON "provider_accounts" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_documents_target_idx" ON "search_documents" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "sessions_provider_chat_idx" ON "sessions" USING btree ("provider","provider_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_skill_id_idx" ON "skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");