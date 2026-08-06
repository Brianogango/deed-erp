# Blob ↔ Prisma parity (DB-001 follow-up)

Operational guide for measuring and reducing dual-write drift between `app_state` JSON blobs and relational Prisma tables.

Related: [Incident response](./INCIDENT_RESPONSE.md) · director Settings / admin APIs · `lib/blob-cutover.ts`

---

## Why this exists

Audit finding **DB-001**: the ERP dual-writes critical domains (blob + Prisma). Silent mirror failure creates count and ID drift. Before retiring any live `deed_*` key, parity must be verified and certified.

## Domain roles

| Role | Meaning | Certify / retire? |
|------|---------|-------------------|
| `catalog` | Relational-first (e.g. products) | Only when counts match (hard stop otherwise) |
| `dual_write` | Both sides should converge (invoices, quotes, sale orders, repairs, …) | Only when counts match (optionally Prisma ahead) |
| `blob_sot` | Blob is still operational SoT (POs, serials, stock moves, deliveries, receipts) | Track coverage; do **not** certify until Prisma catches up |

## How to run a check

### Director UI / API (preferred)

```http
GET  /api/admin/blob-cutover
POST /api/admin/blob-cutover   { "action": "verify" }
```

Director session required. `verify` persists certificate rows (`verified` / `blocked` / `tracked`).

Further actions (still never blind-delete):

- `certify` — only when `parityOk`
- `archive` — copy live key → `archive:…` (live retained)
- `retire` — delete live key only with confirmation `RETIRE <blobKey>` after archive

### Cron / SSH (ops)

From the application directory with `.env` loaded:

```bash
pnpm exec tsx scripts/check-blob-parity.mjs
pnpm exec tsx scripts/check-blob-parity.mjs --json
```

Exit code **1** when catalog hard-stops or dual-write gaps exist (blob-SoT lag alone does not fail the job).

## Contabo snapshot (2026-08-05, illustrative)

Observed after AGENT packages (counts move over time):

| Domain | Blob | Prisma | Notes |
|--------|------|--------|-------|
| products | 468 | 451 | Catalog hard-stop — reconcile missing products |
| invoices | 152 | 140 | Dual-write gap — investigate mirror |
| sale_orders | 147 | 147 | OK |
| quotes | 50 | 50 | OK |
| repairs | 198 | 200 | Prisma slightly ahead — OK with allow-ahead |
| serials | 203 | 15 | Blob-SoT lag — expected until serial cutover |
| stock moves | 121 | 0 | Blob-SoT — Prisma mirror not populated |
| purchase orders | 22 | 0 | Blob-SoT |
| stock_levels | — | 451 | Matches product count after AGENT-DB-001 backfill |

## Safe next migration steps

1. Run `verify` weekly; treat dual-write / catalog gaps as SEV-2.
2. For products gap: export blob-only SKUs, create missing Prisma rows or archive orphans deliberately.
3. For invoices gap: compare ID sets; run `POST /api/admin/backfill-invoices` (director or `x-internal-secret`) to merge Prisma → `deed_invoices` by id, or repair missing Prisma rows. Store sync now refuses to drop non-draft invoices from a truncated client write.
4. Keep blob-SoT domains on blob writes until a dedicated cutover project migrates POs / serials / stock moves.
5. Never `retire` a live key without archive + Director confirmation.

## What this package does **not** do

- Full blob retirement
- Changing which store the UI treats as SoT
- Client pagination UI (see PERF-001)
