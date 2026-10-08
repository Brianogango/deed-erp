-- Additive, non-destructive: two nullable columns on account_codes, filled
-- from the deed_accounts screen copy, and any account only the copy has
-- added to the table. Apply BEFORE deploying the release that reads the chart
-- of accounts from account_codes (Prisma selects these columns).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_account_screen_fields_safe.sql
--
-- screen_id keeps the id the screens already use for each account, so links
-- made against it still resolve. account_codes.balance becomes the static
-- balance the Chart of Accounts screen shows (no server code reads it; the
-- ledger balances come from journal lines).

ALTER TABLE "account_codes" ADD COLUMN IF NOT EXISTS "screen_id" TEXT;
ALTER TABLE "account_codes" ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT;

BEGIN;

-- Latest copy per code (the copy could hold a code twice).
CREATE TEMP TABLE screen_accounts_tx ON COMMIT DROP AS
SELECT DISTINCT ON (btrim(r.payload->>'code')) btrim(r.payload->>'code') AS code, r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_accounts' AND btrim(coalesce(r.payload->>'code', '')) <> ''
ORDER BY btrim(r.payload->>'code'), r.updated_at DESC NULLS LAST;

-- Pre-flight: accounts only the screen copy has (never reached the table).
SELECT count(*) AS only_in_screen_copy
FROM screen_accounts_tx s
WHERE NOT EXISTS (SELECT 1 FROM "account_codes" a WHERE a.code = s.code);

INSERT INTO "account_codes" (id, code, name, account_type, account_group, sub_group, is_active, is_dynamic, dynamic_key, balance, notes, created_at, updated_at)
SELECT gen_random_uuid(), left(s.code, 20), left(coalesce(nullif(s.payload->>'name', ''), s.code), 200),
       left(coalesce(nullif(s.payload->>'type', ''), 'asset'), 20),
       left(nullif(s.payload->>'group', ''), 120), left(nullif(s.payload->>'subGroup', ''), 120),
       coalesce((s.payload->>'isActive')::boolean, true), coalesce((s.payload->>'isDynamic')::boolean, false),
       left(nullif(s.payload->>'dynamicKey', ''), 40), 0, nullif(s.payload->>'notes', ''), now(), now()
FROM screen_accounts_tx s
WHERE length(s.code) <= 20
ON CONFLICT (code) DO NOTHING;

UPDATE "account_codes" a SET
  "screen_id"       = coalesce(a."screen_id", nullif(s.payload->>'id', '')),
  "bank_account_id" = coalesce(a."bank_account_id", nullif(s.payload->>'bankAccountId', '')),
  "balance"         = CASE WHEN (s.payload->>'balance') ~ '^-?[0-9]+(\.[0-9]+)?$'
                           THEN round((s.payload->>'balance')::numeric, 2) ELSE a."balance" END
FROM screen_accounts_tx s
WHERE s.code = a.code;

COMMIT;

SELECT count(*) AS accounts, count(screen_id) AS with_screen_id, count(bank_account_id) AS bank_linked FROM "account_codes";
