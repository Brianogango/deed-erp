# Infra platform — Redis, object store, reporting path

Optional cache, queue, file, and reporting infrastructure. Production keeps working with **no Redis, no S3, and no replica**: memory cache/queues, local filesystem files, and primary-database report snapshots.

Related: [DATA_SAFETY_MIGRATION.md](./DATA_SAFETY_MIGRATION.md) · [BLOB_PRISMA_PARITY.md](./BLOB_PRISMA_PARITY.md) · [FINANCE_PHASE8_ANALYTICS.md](./FINANCE_PHASE8_ANALYTICS.md)

## What this adds

| Piece | Default | Optional production |
|-------|---------|---------------------|
| Redis cache + lists | In-process memory | `REDIS_URL` (self-hosted) or Upstash REST |
| Durable job queue | Postgres `background_jobs` + Redis list wake-up | same tables; Redis speeds drain |
| Object store | Local `BLOB_STORE_DIR` / `UPLOADS_DIR` | `OBJECT_STORE_DRIVER=s3` (MinIO, Contabo Object Storage, AWS) |
| Reporting reads | Primary Postgres | `REPORTING_DATABASE_URL` replica |
| Report snapshots | `report_snapshots` + 60s Redis cache | TTL env overrides |

Operational posting, invoices, and stock writes stay on `DATABASE_URL`. Snapshots are a **read** acceleration, not a second source of truth.

## Redis

`lib/infra/redis.ts` is Node-only (not Edge middleware). Session revocation and login rate limits keep their existing Edge-safe Upstash clients.

Priority:

1. `REDIS_URL` (`redis://` or `rediss://`)
2. `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
3. Memory fallback (and automatic fallback if Redis is down)

Used for:

- Accounting report cache (`deed:report:*`)
- Job wake-up lists (`deed:queue:jobs`)
- Report generation counter / invalidation timestamp

## Object store

`lib/infra/object-store.ts`

| Bucket | Local layout | Consumers |
|--------|--------------|-----------|
| `blobs` | `$BLOB_STORE_DIR/<key>.blob` | Expense receipts, repair/product photos (`lib/blob-store.ts`) |
| `uploads` | `$UPLOADS_DIR/<key>` | Sale-order attachments, lead email attachments |

S3 keys are `{OBJECT_STORE_PREFIX}/{bucket}/{key}`. Existing on-disk files keep working when the driver stays `fs`.

## Read-optimised reporting

Accounting P&L, trial balance, and balance sheet:

1. Redis cache (default 60s)
2. Fresh `report_snapshots` row (default 300s, invalidated on journal post)
3. Live compute against `REPORTING_DATABASE_URL` or the primary
4. Persist snapshot + cache

Query `source=live` to skip cache/snapshot, `source=snapshot` to require a stored row.

Responses include `_reporting` (`source`, `generatedAt`, `ageMs`, `stale`) and header `x-deed-report-source`.

Posted journal writes enqueue a debounced `refresh_core_reports` job.

A covering index `idx_journal_entries_posted_date` speeds the remaining live scans.

## Cron

`GET`/`POST` `/api/cron/infra` (same `CRON_SECRET` as other crons) refreshes core snapshots and drains the job worker.

Apply the additive migration before relying on snapshots/jobs:

```bash
node scripts/run-safe-infra-platform.mjs
# Contabo, as postgres, if deed_user cannot ALTER:
# scripts/apply-sql-as-postgres.sh database/migrations/20260920_infra_platform_safe.sql
# GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE report_snapshots, background_jobs TO deed_user;
```

## Tests

```bash
npm test -- --run __tests__/infra-platform.test.ts __tests__/blob-store.test.ts __tests__/gl-reports.test.ts
```
