# Prisma state cutover runbook

This cutover stops runtime writes of structured ERP data to whole-collection
`app_state` JSON blobs. Normalized Prisma models remain authoritative for
domain APIs. Legacy shared-store screens use `erp_state_keys` plus one
`erp_state_records` row per business record until their UI is fully moved to
dedicated REST hooks.

## Production order

1. Take a PostgreSQL backup.
2. Create the additive tables:
   ```bash
   pnpm migrate:erp-state-cutover:safe
   ```
3. Inspect the existing data without writing:
   ```bash
   pnpm backfill:app-state -- --dry-run
   ```
4. Backfill every existing `deed_*` key:
   ```bash
   pnpm backfill:app-state
   ```
5. Compare counts:
   ```sql
   SELECT COUNT(*) FROM app_state WHERE key LIKE 'deed_%';
   SELECT COUNT(*) FROM erp_state_keys;
   SELECT key, COUNT(*) FROM erp_state_records GROUP BY key ORDER BY key;
   ```
6. Deploy the application.
7. Verify create/edit flows in Sales, Purchases, Inventory, Repair, Finance,
   POS, Delivery, HR, CRM, Expenses, Deposits, Holdovers, and Settings.
8. Keep `app_state` unchanged during the rollback window. Runtime reads only
   use it when a key has not yet been backfilled.

## Data-safety rules

- Never delete `app_state` during the migration.
- A runtime save failure is propagated; the API must not claim success.
- Collection writes update `erp_state_keys.version`, including empty arrays,
  so SSE clients observe deletions.
- Binary attachments remain in the existing external blob store; business
  records and attachment metadata are held in PostgreSQL.
- Retire legacy rows only after parity certification and a tested backup.
