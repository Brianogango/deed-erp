// One-time correction for TIMESTAMPTZ values written by Prisma while the
// database session timezone was not UTC.
//
// Background (see lib/prisma-pg-config.ts and docs/PRISMA_UTC_SESSION_FIX.md):
// Prisma's pg adapter sends DateTime values as UTC wall-clock text with no
// offset. Postgres read that text in the session timezone (Europe/Berlin on
// Contabo), so every Prisma-written TIMESTAMPTZ was stored 2h early (1h in
// winter). Prisma hid it by shifting on read. Once Prisma sessions are pinned
// to UTC, those historical values must be moved to their true instant:
//
//     corrected = (stored AT TIME ZONE <source tz>) AT TIME ZONE 'UTC'
//
// i.e. take the wall clock Postgres shows in the source zone and read it as
// UTC. DST is handled exactly by Postgres.
//
// Only columns that are KNOWN to be written exclusively by Prisma are moved.
// Tables that also receive raw-SQL / migration / database-clock writes hold a
// mix of correct and shifted rows that cannot be told apart, so they are
// reported and left unchanged.
//
// Usage (application STOPPED, fresh backup taken):
//   node scripts/fix-prisma-timestamptz-offset.mjs                 # dry run (default)
//   node scripts/fix-prisma-timestamptz-offset.mjs --apply --backup /root/x.dump
// Options:
//   --source-tz <zone>   zone Prisma sessions used before the fix
//                        (default: the database's default TimeZone)
//   --allow-active-connections   apply even if other sessions are connected

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const apply = flag('--apply')
const backupPath = opt('--backup')


// Reviewed 2026-09-21 against origin/master e63c5a16: no raw SQL, migration
// data writes or database-clock writers set timestamps in these tables — every
// TIMESTAMPTZ value in them came through Prisma.
export const PRISMA_ONLY_TABLES = [
  'blob_cutover_certificates',
  'communication_messages',
  'communication_threads',
  'customer_assets',
  'deposit_payments',
  'deposits',
  'device_serial_costs',
  'document_activities',
  'document_messages',
  'fiscal_locks',
  'holdovers',
  'inventory_batches',
  'journal_entries',
  'journal_entry_lines',
  'label_print_jobs',
  'leads',
  'mpesa_stk_requests',
  'notification_attempts',
  'notification_dead_letters',
  'notification_endpoints',
  'notification_escalations',
  'notification_preferences',
  'notification_templates',
  'payment_allocations',
  'price_list_items',
  'product_valuations',
  'reconfiguration_approvals',
  'reconfiguration_attachments',
  'reconfiguration_installation_lines',
  'reconfiguration_qa_checks',
  'sale_orders',
  'sales_inbound_emails',
  'store_audit_archive',
  'valuation_events',
]

// Mixed writers: raw SQL (`sql` pool), migration seeds/updates, or NOW()-based
// scripts also write these, so correct and shifted rows are indistinguishable.
// Left unchanged; residual error is at most the historical offset.
export const MIXED_WRITER_TABLES = {
  account_codes: 'seeded/updated by accounting migrations with NOW()',
  approval_rules: 'seeded by migrations',
  bulk_stock_levels: 'raw SQL writers',
  device_component_installations: 'raw SQL writer',
  device_configuration_snapshots: 'raw SQL writer',
  erp_state_keys: 'backfill script uses NOW()',
  erp_state_records: 'raw SQL upserts use NOW()',
  exchange_rates: 'seeded by migrations',
  journals: 'seeded by migrations',
  leave_balances: 'raw SQL writers',
  notification_deliveries: 'raw SQL writers',
  notification_events: 'raw SQL writer',
  notification_outbox: 'raw SQL writers',
  notification_recipients: 'raw SQL writer (+ notify trigger)',
  price_lists: 'seeded by migrations',
  reconfiguration_removal_lines: 'raw SQL writer',
  reconfiguration_work_orders: 'raw SQL writer',
  salary_advances: 'raw SQL writer',
  stock_reservations: 'raw SQL writer',
}

const MARKER_TABLE = 'prisma_utc_fix_log'
const qi = name => `"${String(name).replace(/"/g, '""')}"`

/** table -> column -> { field, prismaSets } from prisma/schema.prisma */
export function parsePrismaDateTimeColumns(schemaText) {
  const out = new Map()
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  let m
  while ((m = modelRe.exec(schemaText))) {
    const [, modelName, body] = m
    const table = (body.match(/@@map\("([^"]+)"\)/) || [])[1] || modelName
    const cols = new Map()
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim()
      const fm = line.match(/^(\w+)\s+DateTime\??(\s|$)/)
      if (!fm) continue
      const column = (line.match(/@map\("([^"]+)"\)/) || [])[1] || fm[1]
      cols.set(column, {
        field: fm[1],
        // Prisma always sends these values itself (verified empirically).
        prismaSets: /@default\(now\(\)\)/.test(line) || /@updatedAt\b/.test(line),
      })
    }
    out.set(table, cols)
  }
  return out
}

async function main() {
  const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma')
  const prismaCols = parsePrismaDateTimeColumns(fs.readFileSync(schemaPath, 'utf8'))
  const connectionString =
    process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('Missing deed_erp_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL')
    process.exit(1)
  }
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const dbTz = (await client.query('SHOW TimeZone')).rows[0].TimeZone
    const sourceTz = opt('--source-tz') || dbTz
    console.log(`Database default TimeZone: ${dbTz}   correcting from: ${sourceTz}   mode: ${apply ? 'APPLY' : 'dry run'}`)
    if (/^(utc|etc\/utc|gmt|z)$/i.test(sourceTz)) {
      console.log('Source zone is UTC: Prisma values were never shifted. Nothing to do.')
      return
    }

    const done = await client.query(`SELECT to_regclass('public.${MARKER_TABLE}') AS t`)
    if (done.rows[0].t) {
      const n = (await client.query(`SELECT count(*)::int n FROM ${MARKER_TABLE}`)).rows[0].n
      if (n > 0) {
        console.error(`${MARKER_TABLE} has ${n} rows: this correction was already applied. Refusing to shift twice.`)
        process.exitCode = 2
        return
      }
    }

    const { rows: tzCols } = await client.query(`
      SELECT table_name, column_name, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
       ORDER BY table_name, ordinal_position`)

    const plan = new Map()      // table -> [columns to shift]
    const report = []
    for (const { table_name: t, column_name: c, column_default: def } of tzCols) {
      const pc = prismaCols.get(t)?.get(c)
      let action; let reason
      if (t === MARKER_TABLE) continue
      if (MIXED_WRITER_TABLES[t]) { action = 'skip'; reason = `mixed writers: ${MIXED_WRITER_TABLES[t]}` }
      else if (!PRISMA_ONLY_TABLES.includes(t)) { action = 'skip'; reason = 'not on the reviewed list — review writers first' }
      else if (!pc) { action = 'skip'; reason = 'column not mapped in Prisma schema' }
      else if (pc.prismaSets) { action = 'shift'; reason = 'Prisma sets value (@default(now())/@updatedAt)' }
      else if (def == null) { action = 'shift'; reason = 'only ever set explicitly by the app via Prisma' }
      else { action = 'skip'; reason = `DB default (${def}) may have filled it — ambiguous` }
      report.push({ t, c, action, reason })
      if (action === 'shift') plan.set(t, [...(plan.get(t) || []), c])
    }

    let totalRows = 0
    for (const r of report) {
      const { rows } = await client.query(
        `SELECT count(${qi(r.c)})::int AS n,
                max(${qi(r.c)}) AS latest,
                (max(${qi(r.c)}) AT TIME ZONE $1) AT TIME ZONE 'UTC' AS latest_fixed
           FROM ${qi(r.t)}`, [sourceTz])
      r.rows = rows[0].n
      r.sample = r.action === 'shift' && rows[0].latest
        ? `${rows[0].latest.toISOString()} -> ${rows[0].latest_fixed.toISOString()}`
        : ''
      if (r.action === 'shift') totalRows += r.rows
    }
    console.log('\nTABLE.COLUMN'.padEnd(52) + 'ACTION  ROWS   REASON / LATEST VALUE (before -> after)')
    for (const r of report) {
      console.log(`${(r.t + '.' + r.c).padEnd(51)}${r.action.padEnd(8)}${String(r.rows).padStart(5)}   ${r.action === 'shift' ? r.sample : r.reason}`)
    }
    console.log(`\n${plan.size} tables / ${[...plan.values()].flat().length} columns / ${totalRows} values to shift.`)

    if (!apply) {
      console.log('Dry run only. Re-run with --apply --backup <dump> while the app is stopped.')
      return
    }
    if (!backupPath || !fs.existsSync(backupPath) || fs.statSync(backupPath).size < 1024) {
      console.error('Refusing to apply: pass --backup <path to a fresh pg_dump file>.')
      process.exitCode = 1
      return
    }
    const others = (await client.query(
      `SELECT count(*)::int n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows[0].n
    if (others > 0 && !flag('--allow-active-connections')) {
      console.error(`Refusing to apply: ${others} other session(s) are connected. Stop the app (pm2 stop deed-erp) first.`)
      process.exitCode = 1
      return
    }

    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
      table_name TEXT NOT NULL, column_name TEXT NOT NULL, rows_shifted INTEGER NOT NULL,
      source_tz TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (table_name, column_name))`)
    for (const [t, cols] of plan) {
      const set = cols.map(c => `${qi(c)} = (${qi(c)} AT TIME ZONE $1) AT TIME ZONE 'UTC'`).join(', ')
      const where = cols.map(c => `${qi(c)} IS NOT NULL`).join(' OR ')
      const res = await client.query(`UPDATE ${qi(t)} SET ${set} WHERE ${where}`, [sourceTz])
      for (const c of cols) {
        const n = report.find(r => r.t === t && r.c === c).rows
        await client.query(
          `INSERT INTO ${MARKER_TABLE} (table_name, column_name, rows_shifted, source_tz) VALUES ($1, $2, $3, $4)`,
          [t, c, n, sourceTz])
      }
      console.log(`shifted ${t}: ${res.rowCount} rows (${cols.join(', ')})`)
    }
    await client.query('COMMIT')
    console.log(`\nApplied. Logged in ${MARKER_TABLE}; a second run will refuse.`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Correction failed and was rolled back:', error)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
