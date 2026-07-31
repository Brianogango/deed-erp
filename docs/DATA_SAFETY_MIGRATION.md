# Prisma-first architecture — data safety

## Absolute rule
**Never delete `app_state` keys** as part of this migration. Blobs remain the operational fallback until a verified cutover.

## What this change does
1. Creates relational tables for accounts, journals, product valuations, stock reservations, approval rules (safe SQL, `IF NOT EXISTS`).
2. **Dual-writes** on blob save:
   - `deed_accounts` → `account_codes`
   - `deed_journalEntries` → `journal_entries`
   - `deed_stockReservations` → `stock_reservations`
   - `deed_repairs_v2` → `repairs` (existing mirror; now includes `retained`)
3. Posts invoice/payment journals to Prisma when invoices are posted or paid via API (client still writes blob journals).
4. Configurable approval thresholds in DB with hardcoded fallback.
5. Weighted-average valuation service (call sites can opt in; does not rewrite historical stock blindly).

## Deploy order (production)
```bash
# 1. Apply tables (non-destructive)
node scripts/run-safe-accounting-foundation.mjs

# 2. Generate Prisma client
pnpm prisma:generate

# 3. Deploy app (dual-write starts)

# 4. Backfill existing blobs (idempotent upsert)
node scripts/backfill-accounting-to-prisma.mjs
# optional: --dry-run first
```

## Verify before any future cutover
Compare counts (examples):
```sql
SELECT COUNT(*) FROM account_codes;
-- vs length of deed_accounts JSON

SELECT COUNT(*) FROM journal_entries;
-- vs length of deed_journalEntries JSON
```
Spot-check 5 refs. Only after match + soak period may blob keys be deprecated (separate change).

## What we deliberately deferred
- Full 8-way Zustand store split (would merge-conflict live features)
- Multi-currency / full pricelist engine
- Deleting Delivery dual-schema (store SO picking ≠ Prisma invoice DN)
- Dropping `app_state` keys
