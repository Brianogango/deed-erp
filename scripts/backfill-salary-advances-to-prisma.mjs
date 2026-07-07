// Backfill salary advances from the legacy app_state JSON blob into the
// relational salary_advances table. Idempotent + non-destructive (app_state is
// left intact). Run AFTER the salary_advances table exists.
//   node scripts/backfill-salary-advances-to-prisma.mjs [--dry-run]
import 'dotenv/config'
import { Pool } from 'pg'

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('No database URL found.'); process.exit(1) }

const DRY = process.argv.includes('--dry-run')
const pool = new Pool({ connectionString, ssl: false })
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ts = v => { const d = new Date(v); return isNaN(d.getTime()) ? null : d }

const client = await pool.connect()
try {
  const { rows } = await client.query("SELECT value FROM app_state WHERE key = 'deed_salaryAdvances'")
  let advances = []
  if (rows.length) { try { const p = JSON.parse(rows[0].value); advances = Array.isArray(p) ? p : [] } catch {} }
  const { rows: empRows } = await client.query('SELECT id FROM employees')
  const validEmp = new Set(empRows.map(r => r.id))

  let inserted = 0, skipped = 0, badEmp = 0
  for (const a of advances) {
    if (!a?.id || !validEmp.has(a.employeeId)) { if (a?.employeeId && !validEmp.has(a.employeeId)) badEmp++; continue }
    const exists = await client.query('SELECT 1 FROM salary_advances WHERE id = $1', [a.id])
    if (exists.rows.length) { skipped++; continue }
    if (DRY) { inserted++; continue }
    await client.query(
      `INSERT INTO salary_advances
        (id, reference, employee_id, employee_name, amount, payment_terms, repayment_months, repayment_start_period,
         monthly_deduction, amount_recovered, outstanding_amount, deductions, reason, status, requested_date,
         needed_by_date, approved_by_user_id, approved_by_name, decision_date, decision_note, paid_date, created_by_user_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (id) DO NOTHING`,
      [
        a.id, a.ref ?? null, a.employeeId, a.employeeName ?? null, num(a.amount),
        a.paymentTerms ?? 'payroll_deduction', num(a.repaymentMonths) || 1, a.repaymentStartPeriod ?? null,
        num(a.monthlyDeduction), num(a.amountRecovered), num(a.outstandingAmount),
        JSON.stringify(Array.isArray(a.deductions) ? a.deductions : []), a.reason ?? null,
        a.status ?? 'pending', ts(a.requestedDate) ?? new Date(), ts(a.neededByDate),
        a.approvedByUserId ?? null, a.approvedByName ?? null, ts(a.decisionDate), a.decisionNote ?? null,
        ts(a.paidDate), a.createdByUserId ?? null, ts(a.requestedDate) ?? new Date(),
      ],
    )
    inserted++
  }
  console.log(`${DRY ? '[DRY RUN] ' : ''}Salary advance backfill: ${inserted} inserted, ${skipped} skipped (existing), ${badEmp} skipped (unknown employee)`)
} catch (error) {
  console.error('Salary advance backfill failed:', error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
