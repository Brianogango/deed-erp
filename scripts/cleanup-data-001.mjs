#!/usr/bin/env node
/**
 * P1-DATA-001 — report (and optionally archive) corrupt refs / implausible dates.
 *
 * Scans:
 *   - deed_refundPayments for refs containing "NaN" (e.g. RFD/0NaN)
 *   - deed_repairs_v2 for intakeDate / date before 2015-01-01 or after today+2y
 *
 * Dry-run by default (report only). Does NOT invent corrected values.
 *
 *   node scripts/cleanup-data-001.mjs
 *   node scripts/cleanup-data-001.mjs --json
 *   node scripts/cleanup-data-001.mjs --apply
 *     → writes originals of matching bad records to
 *       scripts/cleanup-data-001-backup-<ISO>.json (no DB mutations)
 *
 * Corrections require business-owner-confirmed values; re-run a follow-up
 * with explicit fix flags only after that sign-off.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const REPAIR_DATE_MIN = '2015-01-01'
const REPAIR_DATE_MAX_YEARS_AHEAD = 2

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function repairDateMaxIso(now = new Date()) {
  const d = new Date(now.getTime())
  d.setFullYear(d.getFullYear() + REPAIR_DATE_MAX_YEARS_AHEAD)
  return d.toISOString().slice(0, 10)
}

function toDateOnly(value) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

function isOutOfBoundsDate(value, now = new Date()) {
  const day = toDateOnly(value)
  if (!day) return value != null && String(value).trim() !== ''
  const max = repairDateMaxIso(now)
  return day < REPAIR_DATE_MIN || day > max
}

function isCorruptRef(ref) {
  return /NaN/i.test(String(ref ?? ''))
}

const apply = process.argv.includes('--apply')
const asJson = process.argv.includes('--json')
const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString })

async function loadJsonArray(client, key) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return []
  try {
    const raw = rows[0].value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function main() {
  const client = await pool.connect()
  const now = new Date()
  const maxDate = repairDateMaxIso(now)
  try {
    const refunds = await loadJsonArray(client, 'deed_refundPayments')
    const repairs = await loadJsonArray(client, 'deed_repairs_v2')

    const nanRefs = refunds
      .filter(r => isCorruptRef(r?.ref))
      .map(r => ({
        storeKey: 'deed_refundPayments',
        id: r.id ?? null,
        ref: r.ref,
        rmaId: r.rmaId ?? null,
        rmaRef: r.rmaRef ?? null,
        amount: r.amount ?? null,
        paymentDate: r.paymentDate ?? null,
        record: r,
      }))

    const badDates = repairs
      .filter(r => isOutOfBoundsDate(r?.intakeDate, now) || isOutOfBoundsDate(r?.date, now))
      .map(r => ({
        storeKey: 'deed_repairs_v2',
        id: r.id ?? null,
        ref: r.ref ?? null,
        intakeDate: r.intakeDate ?? null,
        date: r.date ?? null,
        customerName: r.customerName ?? null,
        reasons: [
          ...(isOutOfBoundsDate(r?.intakeDate, now) ? [`intakeDate=${r.intakeDate}`] : []),
          ...(isOutOfBoundsDate(r?.date, now) ? [`date=${r.date}`] : []),
        ],
        record: r,
      }))

    const report = {
      generatedAt: now.toISOString(),
      mode: apply ? 'apply-backup-only' : 'dry-run',
      bounds: { min: REPAIR_DATE_MIN, max: maxDate },
      counts: {
        refundPaymentsScanned: refunds.length,
        repairsScanned: repairs.length,
        nanRefs: nanRefs.length,
        outOfBoundsDates: badDates.length,
      },
      knownTargets: {
        rfd0NaN: nanRefs.filter(r => String(r.ref) === 'RFD/0NaN').length,
        rep352227: badDates.filter(r => String(r.ref) === 'REP-352227').length,
      },
      nanRefs: nanRefs.map(({ record, ...rest }) => rest),
      outOfBoundsDates: badDates.map(({ record, ...rest }) => rest),
      note:
        'No automatic corrections are applied. With --apply, originals are written to a JSON backup for owner review.',
    }

    if (asJson) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`P1-DATA-001 cleanup (${report.mode})`)
      console.log(`Date bounds: ${REPAIR_DATE_MIN} .. ${maxDate}`)
      console.log(`Scanned refundPayments=${refunds.length}, repairs=${repairs.length}`)
      console.log(`NaN refs: ${nanRefs.length}`)
      for (const row of nanRefs) {
        console.log(`  - ${row.ref} id=${row.id} rma=${row.rmaRef ?? row.rmaId}`)
      }
      console.log(`Out-of-bounds repair dates: ${badDates.length}`)
      for (const row of badDates) {
        console.log(`  - ${row.ref} id=${row.id} ${row.reasons.join(', ')}`)
      }
      if (!nanRefs.length && !badDates.length) {
        console.log('OK: no matching corrupt refs or out-of-bounds dates')
      } else if (!apply) {
        console.log('\nDry-run only. Re-run with --apply to write originals to a JSON backup (no DB writes).')
      }
    }

    if (apply) {
      const stamp = now.toISOString().replace(/[:.]/g, '-')
      const outPath = resolve(ROOT, `scripts/cleanup-data-001-backup-${stamp}.json`)
      const backup = {
        generatedAt: now.toISOString(),
        purpose: 'P1-DATA-001 original bad-record archive (no corrections applied)',
        bounds: report.bounds,
        originals: {
          deed_refundPayments: nanRefs.map(r => r.record),
          deed_repairs_v2: badDates.map(r => r.record),
        },
      }
      writeFileSync(outPath, JSON.stringify(backup, null, 2))
      console.log(`\nWrote originals backup: ${outPath}`)
      console.log('DB left unchanged — confirm corrected values with business owner before any mutation.')
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
