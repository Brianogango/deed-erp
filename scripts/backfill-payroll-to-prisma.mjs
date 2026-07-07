// Backfill payroll runs + payslips from the legacy app_state JSON into the
// relational payroll_runs / payslips tables. Idempotent + non-destructive.
//   node scripts/backfill-payroll-to-prisma.mjs [--dry-run]
import 'dotenv/config'
import { Pool } from 'pg'

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('No database URL found.'); process.exit(1) }

const DRY = process.argv.includes('--dry-run')
const pool = new Pool({ connectionString, ssl: false })
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const mStart = (m, y) => new Date(Date.UTC(y, Math.max(0, (Number(m) || 1) - 1), 1))
const mEnd = (m, y) => new Date(Date.UTC(y, Math.max(0, Number(m) || 1), 0))

async function loadJson(client, key) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return []
  try { const p = JSON.parse(rows[0].value); return Array.isArray(p) ? p : [] } catch { return [] }
}

const client = await pool.connect()
try {
  const runs = await loadJson(client, 'deed_payrollRuns')
  const payslips = await loadJson(client, 'deed_payslips')
  const { rows: empRows } = await client.query('SELECT id FROM employees')
  const validEmp = new Set(empRows.map(r => r.id))

  let runsIns = 0, runsSkip = 0, psIns = 0, psSkip = 0
  for (const r of runs) {
    if (!r?.id || !r.ref) { runsSkip++; continue }
    const exists = await client.query('SELECT 1 FROM payroll_runs WHERE id = $1 OR run_reference = $2', [r.id, r.ref])
    if (exists.rows.length) { runsSkip++; continue }
    if (DRY) { runsIns++; continue }
    await client.query(
      `INSERT INTO payroll_runs (id, run_reference, period_start, period_end, run_date, period_month, period_year, status, total_gross, total_deductions, total_net, posted_journal_id, created_at)
       VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10,$11,now()) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.ref, mStart(r.month, r.year), mEnd(r.month, r.year), String(r.month), Number(r.year) || null,
       r.status ?? 'pending_approval', num(r.totalGross), num(r.totalDeductions), num(r.totalNet), r.postedJournalId ?? null],
    )
    runsIns++
  }

  for (const p of payslips) {
    if (!p?.id || !validEmp.has(p.employeeId)) { psSkip++; continue }
    const exists = await client.query('SELECT 1 FROM payslips WHERE id = $1', [p.id])
    if (exists.rows.length) { psSkip++; continue }
    if (DRY) { psIns++; continue }
    const gross = num(p.grossPay), ded = num(p.deductions)
    await client.query(
      `INSERT INTO payslips (id, payroll_run_id, employee_id, reference, employee_name, basic_salary, house_allowance, transport_allowance, gross_pay, total_deductions, net_pay, advance_deductions, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,0,$7,$8,$9,$10::jsonb,$11,now()) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.payrollRunId, p.employeeId, p.ref ?? null, p.employeeName ?? null, gross, gross, ded, num(p.netPay),
       JSON.stringify(Array.isArray(p.salaryAdvanceDeductions) ? p.salaryAdvanceDeductions : []), p.status ?? 'draft'],
    )
    psIns++
  }

  console.log(`${DRY ? '[DRY RUN] ' : ''}Payroll backfill: runs ${runsIns} inserted / ${runsSkip} skipped; payslips ${psIns} inserted / ${psSkip} skipped`)
} catch (error) {
  console.error('Payroll backfill failed:', error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
