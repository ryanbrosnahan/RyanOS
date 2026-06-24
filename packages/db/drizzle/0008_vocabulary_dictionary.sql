CREATE TABLE "vocabulary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"definition" text,
	"part_of_speech" text,
	"pronunciation" text,
	"translation" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"definition_source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "vocabulary_encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"source_type" text,
	"source_title" text,
	"source_url" text,
	"context" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "vocabulary_entries" ADD CONSTRAINT "vocabulary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "vocabulary_encounters" ADD CONSTRAINT "vocabulary_encounters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "vocabulary_encounters" ADD CONSTRAINT "vocabulary_encounters_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "vocabulary_entries_user_language_term_idx" ON "vocabulary_entries" USING btree ("user_id","language_code","normalized_term");

CREATE INDEX "vocabulary_entries_user_category_idx" ON "vocabulary_entries" USING btree ("user_id","category","updated_at");

CREATE INDEX "vocabulary_entries_user_language_idx" ON "vocabulary_entries" USING btree ("user_id","language_code","updated_at");

CREATE INDEX "vocabulary_entries_user_status_updated_idx" ON "vocabulary_entries" USING btree ("user_id","status","updated_at");

CREATE INDEX "vocabulary_encounters_user_entry_occurred_idx" ON "vocabulary_encounters" USING btree ("user_id","entry_id","occurred_at");

CREATE INDEX "vocabulary_encounters_user_occurred_idx" ON "vocabulary_encounters" USING btree ("user_id","occurred_at");
