ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_user_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_user_id_idx"
  ON "users" ("auth_user_id")
  WHERE "auth_user_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_user_email_idx"
  ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_session_token_idx"
  ON "session" ("token");

CREATE INDEX IF NOT EXISTS "auth_session_user_idx"
  ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp with time zone,
  "refreshTokenExpiresAt" timestamp with time zone,
  "scope" text,
  "password" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_account_provider_account_idx"
  ON "account" ("providerId", "accountId");

CREATE INDEX IF NOT EXISTS "auth_account_user_idx"
  ON "account" ("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "auth_verification_identifier_idx"
  ON "verification" ("identifier");

DROP INDEX IF EXISTS "sessions_provider_chat_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_provider_chat_idx"
  ON "sessions" ("user_id", "provider", "provider_chat_id");
