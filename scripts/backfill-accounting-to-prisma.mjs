/**
 * Prefer the authenticated admin API (keeps Node free of TS imports):
 *
 *   curl -X POST https://<host>/api/admin/backfill-accounting \
 *     -H "Content-Type: application/json" \
 *     -H "Cookie: ..." \
 *     -d '{"force":true}'
 *
 * Or with INTERNAL_API_SECRET if wired like backfill-repairs.
 *
 * Schema first:
 *   npm run migrate:accounting-foundation:safe
 *   npm run prisma:generate
 *
 * This script only prints the safety checklist — it never deletes app_state.
 */
console.log(`
DeedERP accounting backfill — data safety checklist
====================================================
1) Apply tables:  npm run migrate:accounting-foundation:safe
2) Prisma client: npm run prisma:generate
3) Deploy app (dual-write on blob saves starts automatically)
4) Backfill via:  POST /api/admin/backfill-accounting  { "force": true }
5) Compare counts (SQL vs JSON array lengths) before any future cutover
6) NEVER delete deed_accounts / deed_journalEntries / deed_* keys yet
`)
