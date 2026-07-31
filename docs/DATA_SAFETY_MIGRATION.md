# Prisma-first architecture — data safety

## Absolute rule
**Never delete `app_state` keys** as part of this migration. Blobs remain the operational fallback until a verified cutover.

## What this change does
1. Creates relational tables for accounts, journals, product valuations, valuation events, stock reservations, approval rules, **deposits**, **holdovers** (safe SQL, `IF NOT EXISTS`).
2. **Dual-writes** on blob save:
   - `deed_accounts` → `account_codes` (metadata only on update — never overwrites live balances with seed)
   - `deed_journalEntries` → `journal_entries`
   - `deed_stockReservations` → `stock_reservations`
   - `deed_deposits` / `deed_deposits_v1` → `deposits`
   - `deed_holdovers` → `holdovers`
   - `deed_repairs_v2` → `repairs` (existing mirror; includes `retained`)
3. Posts invoice/payment journals to Prisma when invoices are posted or paid via API.
4. On GRN validate / delivery validate: weighted-average valuation + STK/COGS journals.
5. Configurable approval thresholds + Settings UI.
6. Sales + Inventory domain seams (API-first helpers; no big-bang 8-store split).
7. Prisma read-only **journals** + **trial balance** (KES) in Finance UI.
8. Safe CoA bootstrap when `deed_accounts` is missing (Contabo case).

## Deploy order (production)
```bash
# 1. Apply tables (non-destructive) — as OS postgres on Contabo when deed_user lacks DDL
install -m 644 database/migrations/20260731_accounting_foundation_safe.sql /tmp/accounting_foundation_safe.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/accounting_foundation_safe.sql
# GRANTs as documented in run-safe-accounting-foundation.mjs

install -m 644 database/migrations/20260731_deposits_holdovers_safe.sql /tmp/deposits_holdovers_safe.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/deposits_holdovers_safe.sql
sudo -u postgres psql -d deed_erp -c "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE deposits, deposit_items, deposit_payments, holdovers TO deed_user;"

# 2. Generate Prisma client + deploy app

# 3. Backfill (never deletes blobs)
curl -X POST https://<host>/api/admin/backfill-accounting \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"force":true}'
```

## What we deliberately still skip
- Deleting any `deed_*` app_state keys
- Multi-currency / full pricelist engine
- Big-bang 8-way Zustand extraction (Sales/Inventory seams only)
