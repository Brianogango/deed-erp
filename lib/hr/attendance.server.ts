import 'server-only'

import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { sql } from '@/lib/auth/db'
import {
  type AttendanceDay, type AttendanceHistoryEntry, type AttendanceStatus, type PayBasis,
  isOfficeIp, monthRange, nairobiDate, networkKey, payableDays,
} from './attendance-core'

/**
 * Attendance storage. Tables are created the first time they are needed (no
 * deploy step), like passkeys and chat.
 *  - office_networks: the office connections a clock-in must come from.
 *  - attendance_days: one row per person per day, with where and how each
 *    clock-in / clock-out was made and a history of every change.
 *  - employee_pay_basis: monthly salary or a daily rate.
 *  - attendance_pay: the days and rate each daily-rate payslip was built from.
 */

let ready: Promise<void> | null = null
export function ensureAttendanceTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS office_networks (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          ip TEXT NOT NULL UNIQUE,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      await sql`
        CREATE TABLE IF NOT EXISTS attendance_days (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          work_date DATE NOT NULL,
          clock_in TIMESTAMPTZ,
          clock_out TIMESTAMPTZ,
          in_ip TEXT,
          out_ip TEXT,
          in_office BOOLEAN NOT NULL DEFAULT false,
          out_office BOOLEAN,
          in_verified BOOLEAN NOT NULL DEFAULT false,
          out_verified BOOLEAN,
          status TEXT NOT NULL DEFAULT 'pending',
          note TEXT,
          history JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (employee_id, work_date)
        )`
      await sql`CREATE INDEX IF NOT EXISTS idx_attendance_days_date ON attendance_days (work_date)`
      await sql`
        CREATE TABLE IF NOT EXISTS employee_pay_basis (
          employee_id TEXT PRIMARY KEY,
          basis TEXT NOT NULL DEFAULT 'monthly',
          daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      await sql`
        CREATE TABLE IF NOT EXISTS attendance_pay (
          payslip_id TEXT PRIMARY KEY,
          payroll_run_id TEXT NOT NULL,
          employee_id TEXT NOT NULL,
          period TEXT NOT NULL,
          days NUMERIC(6,2) NOT NULL,
          daily_rate NUMERIC(12,2) NOT NULL,
          amount NUMERIC(14,2) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
    })().catch(err => { ready = null; throw err })
  }
  return ready
}

export class AttendanceError extends Error {
  status: number
  expose = true
  constructor(message: string, status = 400) { super(message); this.status = status }
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null)
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

function toDay(r: Record<string, unknown>): AttendanceDay {
  return {
    id: String(r.id),
    employeeId: String(r.employee_id),
    workDate: ymd(r.work_date),
    clockIn: iso(r.clock_in),
    clockOut: iso(r.clock_out),
    inOffice: Boolean(r.in_office),
    outOffice: r.out_office === null || r.out_office === undefined ? null : Boolean(r.out_office),
    inVerified: Boolean(r.in_verified),
    outVerified: r.out_verified === null || r.out_verified === undefined ? null : Boolean(r.out_verified),
    status: (String(r.status) as AttendanceStatus) || 'pending',
    note: r.note ? String(r.note) : null,
    history: Array.isArray(r.history) ? r.history as AttendanceHistoryEntry[] : [],
  }
}

// ── Office connections ─────────────────────────────────────────────────────

export type OfficeNetwork = { id: string; label: string; ip: string; createdAt: string }

export async function listOfficeNetworks(): Promise<OfficeNetwork[]> {
  await ensureAttendanceTables()
  const { rows } = await sql`SELECT * FROM office_networks ORDER BY created_at`
  return rows.map(r => ({ id: String(r.id), label: String(r.label), ip: String(r.ip), createdAt: iso(r.created_at) ?? '' }))
}

/** Remember the connection this request came from as an office connection. */
export async function addOfficeNetwork(label: string, requestIp: string | null, actorId: string): Promise<OfficeNetwork> {
  await ensureAttendanceTables()
  const key = networkKey(requestIp)
  if (!key) throw new AttendanceError('Could not tell which connection you are on. Try again from the office Wi-Fi.')
  const name = label.trim().slice(0, 80) || 'Office'
  const existing = (await listOfficeNetworks()).find(n => n.ip === key)
  if (existing) throw new AttendanceError(`This connection is already saved as "${existing.label}"`, 409)
  const id = crypto.randomUUID()
  await sql`INSERT INTO office_networks (id, label, ip, created_by) VALUES (${id}, ${name}, ${key}, ${actorId})`
  return { id, label: name, ip: key, createdAt: new Date().toISOString() }
}

export async function removeOfficeNetwork(id: string): Promise<void> {
  await ensureAttendanceTables()
  await sql`DELETE FROM office_networks WHERE id = ${id}`
}

export async function onOfficeNetwork(ip: string | null): Promise<boolean> {
  return isOfficeIp(ip, await listOfficeNetworks())
}

// ── Who is clocking ────────────────────────────────────────────────────────

/** The employee record behind a login: the link set on the user, else one unmistakable match by email or name. */
export async function employeeForUser(user: { id: string; name?: string | null; email?: string | null; username?: string | null }) {
  const linked = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } }).catch(() => null)
  if (linked?.employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: linked.employeeId } })
    if (e) return e
  }
  const email = String(user.email ?? '').trim().toLowerCase()
  const candidates = await prisma.employee.findMany({ where: { isActive: true } })
  const byEmail = email ? candidates.filter(e => [e.email, e.workEmail].some(v => String(v ?? '').trim().toLowerCase() === email)) : []
  if (byEmail.length === 1) return byEmail[0]
  const name = String(user.name ?? '').trim().toLowerCase()
  const byName = name ? candidates.filter(e => `${e.firstName} ${e.lastName}`.trim().toLowerCase() === name) : []
  return byName.length === 1 ? byName[0] : null
}

// ── Days ───────────────────────────────────────────────────────────────────

export async function getDay(employeeId: string, workDate: string): Promise<AttendanceDay | null> {
  await ensureAttendanceTables()
  const { rows } = await sql`SELECT * FROM attendance_days WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date`
  return rows.length ? toDay(rows[0]) : null
}

export async function listDays(filter: { from: string; to: string; employeeId?: string }): Promise<AttendanceDay[]> {
  await ensureAttendanceTables()
  const { rows } = filter.employeeId
    ? await sql`SELECT * FROM attendance_days WHERE employee_id = ${filter.employeeId} AND work_date BETWEEN ${filter.from}::date AND ${filter.to}::date ORDER BY work_date`
    : await sql`SELECT * FROM attendance_days WHERE work_date BETWEEN ${filter.from}::date AND ${filter.to}::date ORDER BY work_date, employee_id`
  return rows.map(toDay)
}

/**
 * Payroll for a month is the line under its attendance: once a run for that
 * month exists (and has not been sent back), its days cannot change.
 */
export async function monthLocked(workDate: string): Promise<string | null> {
  const [y, m] = workDate.split('-').map(Number)
  const runs = await prisma.payrollRun.findMany({
    where: { periodYear: y, status: { in: ['pending_approval', 'approved', 'posted'] } },
    select: { runReference: true, periodMonth: true },
  })
  const run = runs.find(r => Number(r.periodMonth) === m)
  return run ? run.runReference : null
}

async function assertOpen(workDate: string) {
  const locked = await monthLocked(workDate)
  if (locked) throw new AttendanceError(`Payroll ${locked} already covers this month, so its attendance is closed`, 409)
}

export type ClockContext = { ip: string | null; verified: boolean; actorName: string }

/**
 * Clock in or out for today (Nairobi). The time is the server's. A clock-in is
 * approved by itself only when it came from an office connection and was
 * confirmed with the person's own Face ID / fingerprint; anything else waits
 * for a supervisor.
 */
export async function clock(employeeId: string, action: 'in' | 'out', ctx: ClockContext): Promise<AttendanceDay> {
  await ensureAttendanceTables()
  const today = nairobiDate()
  // Clock-ins are always recorded, even after payroll covers the month; only supervisor changes are closed.
  const inOffice = await onOfficeNetwork(ctx.ip)
  const now = new Date().toISOString()
  const where = inOffice ? 'office connection' : `outside the office (${ctx.ip ?? 'unknown address'})`
  const how = ctx.verified ? 'Face ID / fingerprint' : 'no Face ID / fingerprint'
  const existing = await getDay(employeeId, today)

  if (action === 'in') {
    if (existing?.clockIn) throw new AttendanceError(`You already clocked in at ${new Date(existing.clockIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}`, 409)
    const status: AttendanceStatus = inOffice && ctx.verified ? 'approved' : 'pending'
    const entry: AttendanceHistoryEntry = { at: now, by: ctx.actorName, action: `Clocked in · ${where} · ${how}` }
    await sql`
      INSERT INTO attendance_days (id, employee_id, work_date, clock_in, in_ip, in_office, in_verified, status, history)
      VALUES (${crypto.randomUUID()}, ${employeeId}, ${today}::date, ${now}, ${ctx.ip}, ${inOffice}, ${ctx.verified}, ${status}, ${JSON.stringify([entry])}::jsonb)
      ON CONFLICT (employee_id, work_date) DO UPDATE SET clock_in = EXCLUDED.clock_in, in_ip = EXCLUDED.in_ip,
        in_office = EXCLUDED.in_office, in_verified = EXCLUDED.in_verified,
        status = CASE WHEN attendance_days.status = 'rejected' THEN 'pending' ELSE EXCLUDED.status END,
        history = attendance_days.history || EXCLUDED.history, updated_at = now()`
    return (await getDay(employeeId, today))!
  }

  if (!existing?.clockIn) throw new AttendanceError('You have not clocked in today', 409)
  if (existing.clockOut) throw new AttendanceError('You already clocked out today', 409)
  const entry: AttendanceHistoryEntry = { at: now, by: ctx.actorName, action: `Clocked out · ${where} · ${how}` }
  // Leaving from outside the office sends an approved day back for a look.
  const status = existing.status === 'approved' && !inOffice ? 'pending' : existing.status
  await sql`
    UPDATE attendance_days SET clock_out = ${now}, out_ip = ${ctx.ip}, out_office = ${inOffice}, out_verified = ${ctx.verified},
      status = ${status}, history = history || ${JSON.stringify([entry])}::jsonb, updated_at = now()
    WHERE id = ${existing.id}`
  return (await getDay(employeeId, today))!
}

/**
 * A supervisor's change to a day: add a missed day, fix the times, approve or
 * reject. Every change needs a reason and is kept in the day's history.
 */
export async function reviewDay(input: {
  employeeId: string; workDate: string; clockIn?: string | null; clockOut?: string | null
  status?: AttendanceStatus; reason: string; actorName: string
}): Promise<AttendanceDay> {
  await ensureAttendanceTables()
  const reason = input.reason.trim()
  if (!reason) throw new AttendanceError('Give a reason for the change')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) throw new AttendanceError('Pick the day')
  if (input.workDate > nairobiDate()) throw new AttendanceError('That day has not happened yet')
  await assertOpen(input.workDate)
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } })
  if (!employee) throw new AttendanceError('Employee not found', 404)

  const existing = await getDay(input.employeeId, input.workDate)
  const clockIn = input.clockIn === undefined ? existing?.clockIn ?? null : input.clockIn
  const clockOut = input.clockOut === undefined ? existing?.clockOut ?? null : input.clockOut
  if (clockIn && clockOut && new Date(clockOut) <= new Date(clockIn)) throw new AttendanceError('Clock-out must be after clock-in')
  for (const t of [clockIn, clockOut]) {
    if (t && nairobiDate(new Date(t)) !== input.workDate) throw new AttendanceError('The times must be on the same day')
  }
  const status = input.status ?? existing?.status ?? 'approved'
  if (status === 'approved' && !clockIn) throw new AttendanceError('Add the clock-in time before approving the day')

  const changes: string[] = []
  const t = (v: string | null) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) : '—')
  if (!existing) changes.push(`Day added ${t(clockIn)}–${t(clockOut)}`)
  else {
    if (clockIn !== existing.clockIn) changes.push(`Clock-in ${t(existing.clockIn)} → ${t(clockIn)}`)
    if (clockOut !== existing.clockOut) changes.push(`Clock-out ${t(existing.clockOut)} → ${t(clockOut)}`)
  }
  if (status !== existing?.status) changes.push(status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Sent back for review')
  if (!changes.length) return existing!
  const entry: AttendanceHistoryEntry = { at: new Date().toISOString(), by: input.actorName, action: changes.join(' · '), reason }

  await sql`
    INSERT INTO attendance_days (id, employee_id, work_date, clock_in, clock_out, status, note, history)
    VALUES (${crypto.randomUUID()}, ${input.employeeId}, ${input.workDate}::date, ${clockIn}, ${clockOut}, ${status}, ${reason}, ${JSON.stringify([entry])}::jsonb)
    ON CONFLICT (employee_id, work_date) DO UPDATE SET clock_in = EXCLUDED.clock_in, clock_out = EXCLUDED.clock_out,
      status = EXCLUDED.status, note = EXCLUDED.note, history = attendance_days.history || EXCLUDED.history, updated_at = now()`
  return (await getDay(input.employeeId, input.workDate))!
}

// ── Pay basis ──────────────────────────────────────────────────────────────

export type PayBasisRow = { employeeId: string; basis: PayBasis; dailyRate: number }

export async function listPayBasis(): Promise<PayBasisRow[]> {
  await ensureAttendanceTables()
  const { rows } = await sql`SELECT * FROM employee_pay_basis`
  return rows.map(r => ({ employeeId: String(r.employee_id), basis: r.basis === 'daily' ? 'daily' : 'monthly', dailyRate: Number(r.daily_rate) || 0 }))
}

export async function setPayBasis(employeeId: string, basis: PayBasis, dailyRate: number, actorId: string): Promise<PayBasisRow> {
  await ensureAttendanceTables()
  if (basis !== 'daily' && basis !== 'monthly') throw new AttendanceError('Pick monthly salary or daily rate')
  const rate = Math.round(Number(dailyRate) * 100) / 100
  if (basis === 'daily' && !(rate > 0)) throw new AttendanceError('Enter the daily rate')
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } })
  if (!employee) throw new AttendanceError('Employee not found', 404)
  await sql`
    INSERT INTO employee_pay_basis (employee_id, basis, daily_rate, updated_by) VALUES (${employeeId}, ${basis}, ${basis === 'daily' ? rate : 0}, ${actorId})
    ON CONFLICT (employee_id) DO UPDATE SET basis = EXCLUDED.basis, daily_rate = EXCLUDED.daily_rate, updated_by = EXCLUDED.updated_by, updated_at = now()`
  return { employeeId, basis, dailyRate: basis === 'daily' ? rate : 0 }
}

/** Daily-rate staff and the days each is owed for a month ("2026-11"). */
export async function dailyPayForMonth(period: string, employeeIds?: string[]): Promise<Map<string, { days: number; rate: number }>> {
  const out = new Map<string, { days: number; rate: number }>()
  const daily = (await listPayBasis()).filter(b => b.basis === 'daily' && (!employeeIds || employeeIds.includes(b.employeeId)))
  if (!daily.length) return out
  const days = await listDays(monthRange(period))
  for (const b of daily) out.set(b.employeeId, { days: payableDays(days.filter(d => d.employeeId === b.employeeId)), rate: b.dailyRate })
  return out
}

export async function recordAttendancePay(rows: { payslipId: string; payrollRunId: string; employeeId: string; period: string; days: number; rate: number; amount: number }[]) {
  if (!rows.length) return
  await ensureAttendanceTables()
  for (const r of rows) {
    await sql`
      INSERT INTO attendance_pay (payslip_id, payroll_run_id, employee_id, period, days, daily_rate, amount)
      VALUES (${r.payslipId}, ${r.payrollRunId}, ${r.employeeId}, ${r.period}, ${r.days}, ${r.rate}, ${r.amount})
      ON CONFLICT (payslip_id) DO UPDATE SET days = EXCLUDED.days, daily_rate = EXCLUDED.daily_rate, amount = EXCLUDED.amount`
  }
}

export async function attendancePayForPayslips(payslipIds: string[]): Promise<Map<string, { days: number; rate: number }>> {
  const out = new Map<string, { days: number; rate: number }>()
  if (!payslipIds.length) return out
  await ensureAttendanceTables()
  const { rows } = await sql`SELECT payslip_id, days, daily_rate FROM attendance_pay WHERE payslip_id = ANY(${payslipIds})`
  for (const r of rows) out.set(String(r.payslip_id), { days: Number(r.days), rate: Number(r.daily_rate) })
  return out
}
