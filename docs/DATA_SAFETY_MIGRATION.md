# Prisma-first architecture — data safety

## Absolute rule
**Never delete `app_state` keys** as part of routine migration. Blobs remain the operational fallback until a **verified → certified → archived** cutover.

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
9. **Multi-currency (KES-first):** document `currencyCode` / `baseCurrencyCode` / `exchangeRateToBase` snapshots; functional currency locked to KES; exchange rates table; no FX journal posting yet.
10. **Pricelists:** Retail / Wholesale / Kilimall map to product selling / wholesale / Kilimall prices; shared resolver; special_pricing approval when unit price undercuts list.
11. **Gated blob cutover:** Settings → Data Cutover / `POST /api/admin/blob-cutover` — verify → certify → archive (copy) → retire live key. Admin reset blocked while protected keys are uncertified (unless explicit force phrase).

## Deploy order (production)
```bash
# 1. Apply tables (non-destructive) — as OS postgres on Contabo when deed_user lacks DDL
install -m 644 database/migrations/20260731_accounting_foundation_safe.sql /tmp/accounting_foundation_safe.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/accounting_foundation_safe.sql
# GRANTs as documented in run-safe-accounting-foundation.mjs

install -m 644 database/migrations/20260731_deposits_holdovers_safe.sql /tmp/deposits_holdovers_safe.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/deposits_holdovers_safe.sql
sudo -u postgres psql -d deed_erp -c "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE deposits, deposit_items, deposit_payments, holdovers TO deed_user;"

install -m 644 database/migrations/20260731_currency_pricelists_cutover_safe.sql /tmp/currency_pricelists_cutover_safe.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/currency_pricelists_cutover_safe.sql
sudo -u postgres psql -d deed_erp -c "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exchange_rates, price_lists, price_list_items, blob_cutover_certificates TO deed_user;"

# 2. Generate Prisma client + deploy app

# 3. Backfill (never deletes blobs)
curl -X POST https://<host>/api/admin/backfill-accounting \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"force":true}'

# 4. Optional — parity report (director session or after login)
# GET /api/admin/blob-cutover
# POST { "action": "verify" } then certify / archive per key when soak proves parity
```

## Blob cutover rules
| Step | Effect |
|------|--------|
| verify | Compare blob vs Prisma counts; write verified/blocked certificates |
| certify | Director signs when `parityOk` |
| archive | Copy live key → `archive:<key>:<timestamp>`; **live key retained** |
| retire | Typed `RETIRE <key>` deletes live key **only if** archive copy exists |

**Hard stop:** `deed_products` blob count ≠ Prisma `products` count blocks certify/archive for that key.

## What we deliberately still skip
- Blind `DELETE FROM app_state` / deleting any `deed_*` key without certificate + archive
- FX journal posting / multi-currency CoA
- Big-bang 8-way Zustand extraction (Sales/Inventory seams only)
