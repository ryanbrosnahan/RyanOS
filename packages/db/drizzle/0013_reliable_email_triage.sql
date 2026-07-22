CREATE TABLE IF NOT EXISTS "email_scan_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "trigger" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "classifier_version" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_scan_runs_trigger_check" CHECK ("trigger" IN ('scheduled', 'manual', 'backfill')),
  CONSTRAINT "email_scan_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_scan_runs_running_user_idx"
  ON "email_scan_runs" ("user_id") WHERE "status" = 'running';
CREATE INDEX IF NOT EXISTS "email_scan_runs_user_started_idx"
  ON "email_scan_runs" ("user_id", "started_at");

CREATE TABLE IF NOT EXISTS "email_triage_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "source_id" uuid NOT NULL REFERENCES "external_sources" ("id"),
  "provider_account_id" uuid NOT NULL REFERENCES "provider_accounts" ("id"),
  "gmail_message_id" text NOT NULL,
  "gmail_thread_id" text NOT NULL,
  "content_fingerprint" text NOT NULL,
  "classifier_version" text NOT NULL,
  "outcome" text NOT NULL,
  "reason_code" text,
  "reason" text,
  "confidence" integer,
  "sender_address" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamp with time zone,
  "evaluated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "email_triage_decisions_outcome_check" CHECK ("outcome" IN ('actionable', 'maybe', 'no_action', 'error')),
  CONSTRAINT "email_triage_decisions_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_triage_decisions_identity_idx"
  ON "email_triage_decisions" ("provider_account_id", "gmail_message_id", "content_fingerprint", "classifier_version");
CREATE INDEX IF NOT EXISTS "email_triage_decisions_user_outcome_idx"
  ON "email_triage_decisions" ("user_id", "outcome", "evaluated_at");
CREATE INDEX IF NOT EXISTS "email_triage_decisions_account_thread_idx"
  ON "email_triage_decisions" ("provider_account_id", "gmail_thread_id", "evaluated_at");

ALTER TABLE "email_action_proposals"
  ADD COLUMN IF NOT EXISTS "triage_decision_id" uuid REFERENCES "email_triage_decisions" ("id");
CREATE INDEX IF NOT EXISTS "email_action_proposals_triage_decision_idx"
  ON "email_action_proposals" ("triage_decision_id");

CREATE TABLE IF NOT EXISTS "email_sender_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "match_type" text NOT NULL,
  "value" text NOT NULL,
  "disposition" text NOT NULL,
  "originating_proposal_id" uuid REFERENCES "email_action_proposals" ("id"),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "email_sender_preferences_match_type_check" CHECK ("match_type" IN ('address', 'domain')),
  CONSTRAINT "email_sender_preferences_disposition_check" CHECK ("disposition" IN ('never', 'likely'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_sender_preferences_active_match_idx"
  ON "email_sender_preferences" ("user_id", "match_type", "value") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "email_sender_preferences_user_disposition_idx"
  ON "email_sender_preferences" ("user_id", "disposition", "updated_at");

INSERT INTO "email_triage_decisions" (
  "user_id",
  "source_id",
  "provider_account_id",
  "gmail_message_id",
  "gmail_thread_id",
  "content_fingerprint",
  "classifier_version",
  "outcome",
  "reason_code",
  "reason",
  "confidence",
  "sender_address",
  "evaluated_at",
  "metadata"
)
SELECT DISTINCT ON (p."provider_account_id", p."source_id")
  p."user_id",
  p."source_id",
  p."provider_account_id",
  COALESCE(s."metadata"->'gmail'->>'messageId', s."external_id", p."id"::text),
  COALESCE(s."metadata"->'gmail'->>'threadId', s."external_id", p."id"::text),
  md5(COALESCE(s."external_id", p."id"::text) || ':' || COALESCE(s."updated_at"::text, '')),
  'legacy-v1',
  'actionable',
  'legacy_proposal',
  p."rationale",
  p."confidence",
  lower(substring(COALESCE(s."metadata"->'gmail'->>'from', '') from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
  p."created_at",
  jsonb_build_object('backfilled', true, 'proposalStatus', p."status")
FROM "email_action_proposals" p
JOIN "external_sources" s ON s."id" = p."source_id"
WHERE p."provider_account_id" IS NOT NULL
  AND p."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "email_action_proposals" p
SET "triage_decision_id" = d."id"
FROM "email_triage_decisions" d
WHERE p."triage_decision_id" IS NULL
  AND d."source_id" = p."source_id"
  AND d."classifier_version" = 'legacy-v1';
