# Prisma state cutover runbook

This cutover stops runtime writes of structured ERP data to whole-collection
`app_state` JSON blobs. Normalized Prisma models remain authoritative for
domain APIs. Legacy shared-store screens use `erp_state_keys` plus one
`erp_state_records` row per business record until their UI is fully moved to
dedicated REST hooks.

## The switch: `STORE_BACKEND`

One environment variable decides which layer owns the shared store
(`lib/store-backend.ts`). It governs reads, writes and `store_records`.

| Value | Reads from | Writes to | Use |
| --- | --- | --- | --- |
| unset / `app_state` (default) | `app_state` | `app_state` | Normal operation until cutover is certified |
| `dual` | `app_state` | `app_state` **and** Prisma projection | Parity soak before cutover |
| `prisma` | Prisma projection (`app_state` fallback for never-backfilled keys) | Prisma projection only | After parity is certified |

Unknown or misspelt values fall back to `app_state`. **Deploying new code
never moves production to Prisma on its own** — only setting
`STORE_BACKEND=prisma` does, and only after steps 1–9 below.

> Incident, 21 Sep 2026: master deployed with the cutover code but without the
> backfill, without `store_records`, and with Prisma as the implicit default.
> Browsers then saved paginated 200-row pages over whole collections and
> `deed_serials` / `deed_stockMoves` were truncated. Production was rolled
> back to 94612268 and restored from `app_state`. The default above and the
> bulk-delete guard below exist because of that.

## Production order

1. Take a PostgreSQL backup and confirm it restores
   (`pg_restore --list <file> | head`).
2. Create the additive tables — **both** migrations:
   ```bash
   npm run migrate:erp-state-cutover:safe
   npm run migrate:store-records:safe
   ```
   Confirm: `SELECT to_regclass('public.store_records'), to_regclass('public.erp_state_keys');`
   (both must be non-null).
3. Deploy the application with `STORE_BACKEND` **unset**. Behaviour is
   unchanged: everything still reads and writes `app_state`.
4. Inspect the existing data without writing:
   ```bash
   npm run backfill:app-state -- --dry-run
   ```
5. Backfill every existing `deed_*` key:
   ```bash
   npm run backfill:app-state
   ```
6. Set `STORE_BACKEND=dual`, `pm2 reload`, and run for at least one full
   business day. Every save now lands in both layers.
7. Compare counts per key — they must match exactly:
   ```sql
   SELECT key, json_array_length(value::json) AS n
     FROM app_state
    WHERE key LIKE 'deed_%' AND left(value, 1) = '['
    ORDER BY key;
   SELECT key, COUNT(*) AS n FROM erp_state_records GROUP BY key ORDER BY key;
   ```
8. Verify create/edit flows in Sales, Purchases, Inventory, Repair, Finance,
   POS, Delivery, HR, CRM, Expenses, Deposits, Holdovers, and Settings.
9. Take a fresh backup, then set `STORE_BACKEND=prisma` and `pm2 reload`.
10. Keep `app_state` unchanged during the rollback window. Rollback is
    `STORE_BACKEND=dual` (or unset) + `pm2 reload`; note that saves made while
    on `prisma` exist only in the projection and must be copied back first.

## Data-safety rules

- Never delete `app_state` during the migration.
- A runtime save failure is propagated; the API must not claim success.
- **Absence is not deletion.** A whole-collection save that would remove more
  than 5 stored records is not applied as a replace:
  - `POST /api/store` merges the payload by id with the stored collection and
    reports the key in `bulkDeleteBlockedKeys` (the browser only sent what it
    had loaded).
  - `saveStoreKeys` refuses it outright (`BulkDeleteRefusedError`) unless the
    caller passes `{ allowBulkDelete: ['deed_…'] }` for an intentional bulk
    delete.
- Never hydrate a whole-collection store key from a paginated REST page
  (`?limit=200`). Load it complete via `/api/store?keys=…`
  (`fetchAndApplyStoreKeys`), which does not sync it back.
- Collection writes update `erp_state_keys.version`, including empty arrays,
  so SSE clients observe deletions.
- If `store_records` is missing the app logs a warning once and skips those
  writes instead of erroring on every save; run step 2.
- Binary attachments remain in the existing external blob store; business
  records and attachment metadata are held in PostgreSQL.
- Retire legacy rows only after parity certification and a tested backup.
