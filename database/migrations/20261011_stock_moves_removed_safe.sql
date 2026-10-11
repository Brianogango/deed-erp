-- Additive, non-destructive. A stock move taken off the list (a goods receipt
-- or delivery reversed) is marked removed instead of staying listed. Apply
-- BEFORE deploying the release that uses it (Prisma selects the column;
-- without it stock moves cannot be read or saved).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < database/migrations/20261011_stock_moves_removed_safe.sql
--
-- Since stock moves moved to this table, a reversal took the moves off the
-- list but the table kept them, so they stayed on screen and a receipt
-- validated again after a reversal could find its old moves and skip adding
-- the stock. Nothing is marked here; the next save of the list does it.

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "removed_at" TIMESTAMPTZ;

\echo 'Moves still listed under a document that has since been reversed or reset (for review)'
SELECT m.document_ref, count(*) AS moves, min(m.created_at)::date AS first_move
FROM "stock_movements" m
WHERE m.screen_extras IS NOT NULL
  AND m.document_ref IS NOT NULL
  AND (
    EXISTS (SELECT 1 FROM "erp_state_records" r WHERE r.key = 'deed_deliveries' AND r.payload->>'ref' = m.document_ref AND r.payload ? 'reversedAt')
    OR EXISTS (SELECT 1 FROM "receipt_documents" d WHERE d.ref = m.document_ref AND d.removed_at IS NULL AND coalesce(d.status, '') NOT IN ('done', 'validated'))
  )
GROUP BY 1 ORDER BY 1;
