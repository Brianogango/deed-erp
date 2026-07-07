// Backfill leave data from the legacy app_state JSON store into the relational
// leave_requests / leave_balances tables. Idempotent and NON-DESTRUCTIVE: it
// never deletes app_state, and skips rows that already exist (by id) so it can
// be re-run safely. Run AFTER `prisma db push` has created the new columns/table.
//
//   node scripts/backfill-leave-to-prisma.mjs           # apply
//   node scripts/backfill-leave-to-prisma.mjs --dry-run # report only
import 'dotenv/config'
import { Pool } from 'pg'

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No database URL found. Set DATABASE_URL.')
  process.exit(1)
}

const DRY = process.argv.includes('--dry-run')
const pool = new Pool({ connectionString, ssl: false })

const LEAVE_TYPES = new Set(['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'unpaid', 'study', 'december_closure'])
// Retired leave-type names seen in legacy app_state data → current policy types.
const LEGACY_TYPE_MAP = {
  flexible_leave: 'annual',
  discretionary: 'annual',
  annual_leave: 'annual',
  december_leave: 'december_closure',
  december: 'december_closure',
  sick_leave: 'sick',
  study_leave: 'study',
  compassionate_leave: 'compassionate',
  paternity_leave: 'paternity',
  maternity_leave: 'maternity',
  unpaid_leave: 'unpaid',
}
const normalizeType = t => LEGACY_TYPE_MAP[String(t)] ?? String(t)
const STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled', 'pending_hr'])
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const dateOrNull = v => { const d = new Date(v); return isNaN(d.getTime()) ? null : d }

async function loadJson(client, key) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return []
  try { const p = JSON.parse(rows[0].value); return Array.isArray(p) ? p : [] } catch { return [] }
}

const client = await pool.connect()
try {
  const requests = await loadJson(client, 'deed_leaveRequests')
  const balances = await loadJson(client, 'deed_leaveBalances')
  const { rows: empRows } = await client.query('SELECT id FROM employees')
  const validEmp = new Set(empRows.map(r => r.id))

  let reqInserted = 0, reqSkipped = 0, reqBadEmp = 0, balUpserted = 0, balBadEmp = 0

  for (const r of requests) {
    if (!r?.id || !validEmp.has(r.employeeId)) { if (r?.employeeId && !validEmp.has(r.employeeId)) reqBadEmp++; continue }
    const leaveType = normalizeType(r.leaveType)
    if (!LEAVE_TYPES.has(leaveType)) { reqSkipped++; continue }
    const status = STATUSES.has(String(r.status)) ? String(r.status) : 'pending_hr'
    const start = dateOrNull(r.startDate), end = dateOrNull(r.endDate)
    if (!start || !end) { reqSkipped++; continue }
    const exists = await client.query('SELECT 1 FROM leave_requests WHERE id = $1', [r.id])
    if (exists.rows.length) { reqSkipped++; continue }
    if (DRY) { reqInserted++; continue }
    await client.query(
      `INSERT INTO leave_requests
        (id, reference, employee_id, employee_name, leave_type, start_date, end_date, days_requested, reason, status, reviewed_by_name, reviewed_at, submitted_by_user_id, is_system_generated, created_at)
       VALUES ($1,$2,$3,$4,$5::leave_type,$6,$7,$8,$9,$10::leave_status,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.ref ?? null, r.employeeId, r.employeeName ?? null, leaveType,
        start, end, num(r.days), r.reason ?? null, status,
        r.hrApprovalBy ?? null, dateOrNull(r.hrDecisionDate), r.submittedByUserId ?? null,
        !!r.isSystemGenerated, dateOrNull(r.submittedDate) ?? new Date(),
      ],
    )
    reqInserted++
  }

  for (const b of balances) {
    if (!validEmp.has(b.employeeId)) { balBadEmp++; continue }
    const leaveType = normalizeType(b.leaveType)
    if (!LEAVE_TYPES.has(leaveType) || typeof b.year !== 'number') continue
    if (DRY) { balUpserted++; continue }
    await client.query(
      `INSERT INTO leave_balances (id, employee_id, leave_type, year, entitlement, carry_forward, used, pending, updated_at)
       VALUES (gen_random_uuid(), $1, $2::leave_type, $3, $4, $5, $6, $7, now())
       ON CONFLICT (employee_id, leave_type, year)
       DO UPDATE SET entitlement = EXCLUDED.entitlement, carry_forward = EXCLUDED.carry_forward, used = EXCLUDED.used, pending = EXCLUDED.pending, updated_at = now()`,
      [b.employeeId, leaveType, b.year, num(b.entitlement), num(b.carryForward), num(b.used), num(b.pending)],
    )
    balUpserted++
  }

  console.log(`${DRY ? '[DRY RUN] ' : ''}Leave backfill complete:`)
  console.log(`  requests: ${reqInserted} inserted, ${reqSkipped} skipped (existing/invalid), ${reqBadEmp} skipped (unknown employee)`)
  console.log(`  balances: ${balUpserted} upserted, ${balBadEmp} skipped (unknown employee)`)
} catch (error) {
  console.error('Leave backfill failed:', error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
