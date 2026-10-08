-- Additive, non-destructive. Apply BEFORE deploying the release that reads
-- opportunity activities from their table and writes the audit log to
-- audit_logs (Prisma selects the new column; without it those reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_logs_off_screen_copies_safe.sql

-- 1. Opportunity activities: the screen fields the table had no column for
--    (subject, outcome, status, completion date, author name).
ALTER TABLE "opportunity_activities" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

UPDATE "opportunity_activities" a SET "screen_extras" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'subject',       r.payload->'subject',
    'outcome',       r.payload->'outcome',
    'status',        r.payload->'status',
    'completedDate', r.payload->'completedDate',
    'createdByName', r.payload->'createdByName',
    'createdDate',   r.payload->'createdDate'
  )), '{}'::jsonb)
FROM "erp_state_records" r
WHERE r.key = 'deed_oppActivities' AND r.payload->>'id' = a.id::text AND a."screen_extras" IS NULL;

-- 2. Audit log: entries from the deed_auditLogs copy become audit_logs rows
--    (entity_type 'document', entity_key = the document reference). Run once;
--    a second run skips entries already copied (matched on new_values.copyId).
INSERT INTO "audit_logs" (user_id, action, entity_type, entity_key, new_values, created_at)
SELECT
  u.id,
  left(coalesce(nullif(r.payload->>'action', ''), 'unknown'), 100),
  'document',
  left(nullif(r.payload->>'documentRef', ''), 120),
  jsonb_strip_nulls(jsonb_build_object(
    'details',  r.payload->'details',
    'username', r.payload->'username',
    'copyId',   r.payload->'id'
  )),
  CASE WHEN r.payload->>'timestamp' ~ '^\d{4}-\d{2}-\d{2}' THEN (r.payload->>'timestamp')::timestamptz AT TIME ZONE 'UTC' ELSE r.created_at END
FROM "erp_state_records" r
LEFT JOIN "users" u ON u.id::text = r.payload->>'userId'
WHERE r.key = 'deed_auditLogs'
  AND NOT EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a.entity_type = 'document' AND a.new_values->>'copyId' = r.payload->>'id'
  );

SELECT 'opportunity_activities' AS tbl, count(*) AS total, count(screen_extras) AS with_extras FROM "opportunity_activities"
UNION ALL
SELECT 'audit_logs (document)', count(*), count(*) FILTER (WHERE new_values ? 'copyId') FROM "audit_logs" WHERE entity_type = 'document';

-- Activities only the screen copy has (never reached the table): they stay
-- listed, read-only.
SELECT count(*) AS activities_only_in_screen_copy
FROM "erp_state_records" r
WHERE r.key = 'deed_oppActivities'
  AND NOT EXISTS (SELECT 1 FROM "opportunity_activities" a WHERE a.id::text = r.payload->>'id');
