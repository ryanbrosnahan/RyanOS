UPDATE "items"
SET
  "due_at" = "created_at" + interval '14 days',
  "metadata" = coalesce("metadata", '{}'::jsonb) || '{"defaultDueAt": true, "defaultDueDays": 14, "backfilledDefaultDueAt": true}'::jsonb,
  "updated_at" = now(),
  "revision" = "revision" + 1
WHERE
  "deleted_at" IS NULL
  AND "due_at" IS NULL
  AND "status" IN ('open', 'active', 'waiting')
  AND "kind" NOT IN ('habit', 'note')
  AND NOT EXISTS (
    SELECT 1
    FROM "recurrence_policies"
    WHERE
      "recurrence_policies"."item_id" = "items"."id"
      AND "recurrence_policies"."deleted_at" IS NULL
      AND "recurrence_policies"."status" = 'active'
  );
