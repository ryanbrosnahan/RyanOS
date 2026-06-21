ALTER TABLE "items" ADD COLUMN "starred_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "items_starred_active_idx" ON "items" USING btree ("user_id","starred_at")
WHERE "starred_at" IS NOT NULL
  AND "deleted_at" IS NULL
  AND "status" IN ('open', 'active', 'waiting');
