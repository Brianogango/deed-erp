# Prisma UTC session fix — runbook

## The bug

Postgres on the Contabo server runs with `TimeZone = Europe/Berlin`. Prisma's
pg adapter sends `DateTime` values as UTC wall-clock text **without an offset**
and, when reading `TIMESTAMPTZ`, overwrites the returned offset with `+00:00`.

| Row written by | Prisma read | psql / raw `sql` / reports |
| --- | --- | --- |
| Prisma (before fix) | correct (errors cancel) | **2 h early** (1 h in winter) |
| Database clock `NOW()` | **2 h in the future** | correct |

Verified on a local Postgres configured as Europe/Berlin (21 Sep 2026).

## The fix

1. `lib/prisma-pg-config.ts` — every Prisma pool starts with
   `options: '-c TimeZone=UTC'` (used by `lib/prisma.ts` and
   `lib/infra/reporting-db.ts`). New writes and reads become correct everywhere.
2. `scripts/fix-prisma-timestamptz-offset.mjs` — one-time correction of values
   Prisma already stored, so they don't appear 2 h early once the fix is live:
   `corrected = (stored AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'`
   (DST-exact: winter rows move 1 h, summer rows 2 h).

The script only moves columns in tables whose timestamps are written
**exclusively by Prisma** (`PRISMA_ONLY_TABLES`). Tables also written by raw
SQL, migrations or `NOW()` (`MIXED_WRITER_TABLES`) hold correct and shifted
rows that can't be told apart; they are reported and left unchanged. Any
`TIMESTAMPTZ` table on neither list is reported as *not reviewed* and skipped.

Safety rails: dry run by default; `--apply` needs `--backup <dump>` and refuses
while other sessions are connected; all updates run in one transaction; a
`prisma_utc_fix_log` table records what moved and blocks a second run.

**Code and correction must go live together.** Deploying the code without the
correction makes old Prisma timestamps show 2 h early; running the correction
without the code makes new Prisma writes wrong again.

## 1. Rehearse on staging (production keeps running)

```bash
cd /var/www/deed-erp
git fetch origin && git checkout --detach origin/<branch-with-this-fix>
sudo -u postgres pg_dump -Fc deed_erp > /root/tzfix-staging-src.dump
sudo -u postgres dropdb --if-exists deed_erp_staging
sudo -u postgres createdb deed_erp_staging
sudo -u postgres pg_restore -d deed_erp_staging --no-owner /root/tzfix-staging-src.dump
STAGING="postgresql:///deed_erp_staging?host=/var/run/postgresql"

# known record, before: the latest journal entries
sudo -u postgres psql -d deed_erp_staging -c "SELECT id, created_at, posted_at FROM journal_entries ORDER BY created_at DESC LIMIT 3;"

# dry run — review every line; send any 'not on the reviewed list' rows for review
sudo -u postgres env DATABASE_URL="$STAGING" node scripts/fix-prisma-timestamptz-offset.mjs

# apply on staging
sudo -u postgres env DATABASE_URL="$STAGING" node scripts/fix-prisma-timestamptz-offset.mjs \
  --apply --backup /root/tzfix-staging-src.dump

# known record, after: times now match when the entry was really made
sudo -u postgres psql -d deed_erp_staging -c "SELECT id, created_at, posted_at FROM journal_entries ORDER BY created_at DESC LIMIT 3;"
```

Pass criteria: the dry run lists no unexpected tables, the apply commits, and a
record whose real time you know (e.g. the 19:18 EAT POS sale on 21 Sep =
16:18 UTC) shows the correct time after the correction.

## 2. Production (quiet window, ~5 minutes of downtime)

```bash
cd /var/www/deed-erp
git fetch origin && git checkout --detach origin/master   # master now contains the fix
NODE_OPTIONS="--max-old-space-size=4096" npm run build    # old build keeps serving
chown -R deedapp:deedapp /var/www/deed-erp

sudo -u deedapp pm2 stop deed-erp                          # downtime starts
sudo -u postgres pg_dump -Fc deed_erp > /root/pre-tzfix-$(date +%F-%H%M).dump
node scripts/fix-prisma-timestamptz-offset.mjs             # dry run, must match staging
node scripts/fix-prisma-timestamptz-offset.mjs --apply --backup /root/pre-tzfix-<stamp>.dump
sudo -u deedapp pm2 start deed-erp                         # new code, UTC sessions
```

Then check a known record in the app and in psql. They should now agree.

## Rollback

`pg_restore` the pre-fix dump into `deed_erp` and deploy the previous commit.
Both halves must roll back together.

## Not changed

- The `sql` (pg) pool still uses the database default zone. It already reads
  and writes `TIMESTAMPTZ` correctly.
- `TIMESTAMP` (without time zone) columns are unaffected by the correction.
- Mixed-writer tables keep up to 2 h error on their historical Prisma-written
  rows. New rows are correct.
