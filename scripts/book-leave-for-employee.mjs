#!/usr/bin/env node
/**
 * Ops helper: book leave for an employee by name (HR-style, auto-approved).
 *
 * Usage (on Contabo app host, from /var/www/deed-erp):
 *   node scripts/book-leave-for-employee.mjs --name "David" --date 2026-07-31 --type annual
 *   node scripts/book-leave-for-employee.mjs --name "David" --date 2026-07-31 --type annual --dry-run
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const nameQuery = String(arg('--name', '')).trim()
const startDate = String(arg('--date', '')).trim()
const endDate = String(arg('--end', startDate)).trim()
const leaveType = String(arg('--type', 'annual')).trim().toLowerCase()
const reason = String(arg('--reason', 'Booked by ops request')).trim()
const dryRun = process.argv.includes('--dry-run')
const pending = process.argv.includes('--pending')

const ALLOWED = new Set(['annual', 'sick', 'compassionate', 'study', 'unpaid', 'maternity', 'paternity'])

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

if (!nameQuery) fail('Pass --name "David"')
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) fail('Pass --date YYYY-MM-DD')
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) fail('Pass --end YYYY-MM-DD')
if (!ALLOWED.has(leaveType)) fail(`Invalid --type ${leaveType}`)

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) fail('DATABASE_URL is not set')

const pool = new Pool({ connectionString })
const year = Number(startDate.slice(0, 4))
const days = 1 // single-day ops booking for now; extend if end != start
const dayCount = (() => {
  const s = new Date(`${startDate}T12:00:00Z`)
  const e = new Date(`${endDate}T12:00:00Z`)
  const diff = Math.round((e - s) / 86_400_000) + 1
  return Math.max(1, diff)
})()

const ENTITLEMENTS = {
  annual: 13,
  sick: 14,
  compassionate: 5,
  study: 5,
  unpaid: 0,
  maternity: 90,
  paternity: 14,
}

async function main() {
  const clients = await pool.query(
    `SELECT id, employee_number, first_name, last_name, email, is_active
     FROM employees
     WHERE (
       first_name ILIKE $1 OR last_name ILIKE $1
       OR (first_name || ' ' || last_name) ILIKE $1
       OR (last_name || ' ' || first_name) ILIKE $1
     )
     ORDER BY is_active DESC, first_name, last_name`,
    [`%${nameQuery}%`],
  )

  if (clients.rows.length === 0) fail(`No employee matched "${nameQuery}"`)
  if (clients.rows.length > 1) {
    console.error(`Multiple employees matched "${nameQuery}":`)
    for (const row of clients.rows) {
      console.error(`  - ${row.first_name} ${row.last_name} (${row.employee_number}) active=${row.is_active} id=${row.id}`)
    }
    // Prefer exact first-name match if unique among actives
    const exact = clients.rows.filter(r =>
      r.is_active
      && (String(r.first_name).toLowerCase() === nameQuery.toLowerCase()
        || `${r.first_name} ${r.last_name}`.toLowerCase() === nameQuery.toLowerCase()),
    )
    if (exact.length !== 1) fail('Narrow --name to a unique employee')
    clients.rows = exact
  }

  const emp = clients.rows[0]
  const employeeName = `${emp.first_name} ${emp.last_name}`.trim()
  console.log(`Matched: ${employeeName} (${emp.employee_number}) <${emp.email || 'no email'}>`)

  const overlap = await pool.query(
    `SELECT reference, status, start_date, end_date
     FROM leave_requests
     WHERE employee_id = $1
       AND status IN ('pending_hr', 'approved')
       AND start_date <= $2::date
       AND end_date >= $3::date
     LIMIT 5`,
    [emp.id, endDate, startDate],
  )
  if (overlap.rows.length) {
    fail(`Overlapping leave already exists: ${overlap.rows.map(r => `${r.reference} ${r.status} ${r.start_date}→${r.end_date}`).join('; ')}`)
  }

  const status = pending ? 'pending_hr' : 'approved'
  const refRow = await pool.query(
    `SELECT MAX(substring(reference from 4)::int) AS n
     FROM leave_requests WHERE reference ~ '^LV/[0-9]+$'`,
  )
  const next = Number(refRow.rows[0]?.n ?? 0) + 1
  const reference = `LV/${String(next).padStart(4, '0')}`
  const id = randomUUID()

  console.log(`Will create ${reference}: ${leaveType} ${startDate}→${endDate} (${dayCount} day(s)) status=${status}`)
  if (dryRun) {
    console.log('Dry run — no write.')
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO leave_requests (
         id, reference, employee_id, employee_name, leave_type,
         start_date, end_date, days_requested, reason, status,
         reviewed_by_name, reviewed_at, review_notes,
         is_system_generated, created_at
       ) VALUES (
         $1, $2, $3, $4, $5::leave_type,
         $6::date, $7::date, $8, $9, $10::leave_status,
         $11, CASE WHEN $10 = 'approved' THEN NOW() ELSE NULL END, $12,
         false, NOW()
       )`,
      [
        id,
        reference,
        emp.id,
        employeeName,
        leaveType,
        startDate,
        endDate,
        dayCount,
        reason,
        status,
        status === 'approved' ? 'Ops booking' : null,
        status === 'approved' ? 'Booked via ops script' : null,
      ],
    )

    const bal = await client.query(
      `SELECT id, entitlement, carry_forward, used, pending
       FROM leave_balances
       WHERE employee_id = $1 AND leave_type = $2::leave_type AND year = $3`,
      [emp.id, leaveType, year],
    )

    if (bal.rows.length === 0) {
      const entitlement = ENTITLEMENTS[leaveType] ?? 0
      await client.query(
        `INSERT INTO leave_balances (
           id, employee_id, leave_type, year, entitlement, carry_forward, used, pending, updated_at
         ) VALUES (
           $1, $2, $3::leave_type, $4, $5, 0,
           $6, $7, NOW()
         )`,
        [
          randomUUID(),
          emp.id,
          leaveType,
          year,
          entitlement,
          status === 'approved' ? dayCount : 0,
          status === 'pending_hr' ? dayCount : 0,
        ],
      )
    } else {
      if (status === 'approved') {
        await client.query(
          `UPDATE leave_balances SET used = used + $1, updated_at = NOW() WHERE id = $2`,
          [dayCount, bal.rows[0].id],
        )
      } else {
        await client.query(
          `UPDATE leave_balances SET pending = pending + $1, updated_at = NOW() WHERE id = $2`,
          [dayCount, bal.rows[0].id],
        )
      }
    }

    await client.query('COMMIT')
    console.log(`OK created ${reference} for ${employeeName} on ${startDate}`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => pool.end())
