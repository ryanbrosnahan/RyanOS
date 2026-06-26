ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('superadmin', 'user'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "user_integration_settings" (
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "integration_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_integration_settings_pk" PRIMARY KEY ("user_id", "integration_id")
);

CREATE INDEX IF NOT EXISTS "user_integration_settings_user_idx"
  ON "user_integration_settings" ("user_id");
