'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtKes } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { userCan } from '@/lib/auth/can'
import { Modal } from '@/components/ui'
import {
  PROBLEM_TEXT, dailyPay, dayProblems, hoursBetween, nairobiDate, payableDays, payableValue,
  type AttendanceDay, type AttendanceStatus, type PayBasis,
} from '@/lib/hr/attendance-core'

type PayBasisRow = { employeeId: string; basis: PayBasis; dailyRate: number }
type Network = { id: string; label: string; ip: string; createdAt: string }

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) : '—')
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
/** "08:30" on a Nairobi day → ISO. */
const toIso = (day: string, hhmm: string) => (hhmm ? new Date(`${day}T${hhmm}:00+03:00`).toISOString() : null)
const toHhmm = (iso: string | null) => (iso ? time(iso) : '')

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || 'Could not save')
  return data
}

type Editing = { employeeId: string; workDate: string; clockIn: string; clockOut: string; status: AttendanceStatus; reason: string; day: AttendanceDay | null }

/**
 * Attendance for a month: the days waiting for a supervisor, what each person
 * is owed, how each is paid, and the office connections clock-ins must come from.
 */
export default function HRAttendanceTab() {
  const { showToast, users, currentUserId } = useApp() as any
  const { employees } = useHrStore()
  const me = (users ?? []).find((u: any) => u.id === currentUserId) ?? null
  const canPay = userCan(me, 'managePayroll')
  const today = nairobiDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [days, setDays] = useState<AttendanceDay[]>([])
  const [basis, setBasis] = useState<PayBasisRow[]>([])
  const [lockedBy, setLockedBy] = useState<string | null>(null)
  const [networks, setNetworks] = useState<{ list: Network[]; current: string | null; currentIsOffice: boolean }>({ list: [], current: null, currentIsOffice: false })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [payEdit, setPayEdit] = useState<{ employeeId: string; name: string; basis: PayBasis; rate: string } | null>(null)
  const [netLabel, setNetLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'review' | 'month' | 'office'>('review')

  const active = useMemo(() => employees.filter(e => e.status !== 'exited').sort((a, b) => a.fullName.localeCompare(b.fullName)), [employees])
  const nameOf = (id: string) => employees.find(e => e.id === id)?.fullName ?? 'Unknown employee'

  const load = useCallback(async () => {
    try {
      const [a, n] = await Promise.all([
        fetch(`/api/attendance?month=${month}`, { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/attendance/networks', { cache: 'no-store' }).then(r => r.json()),
      ])
      setDays(Array.isArray(a.days) ? a.days : [])
      setBasis(Array.isArray(a.payBasis) ? a.payBasis : [])
      setLockedBy(a.lockedBy ?? null)
      setNetworks({ list: Array.isArray(n.networks) ? n.networks : [], current: n.current ?? null, currentIsOffice: !!n.currentIsOffice })
    } catch { /* offline */ }
  }, [month])
  useEffect(() => { void load() }, [load])

  const toReview = days.filter(d => d.status === 'pending' || (d.status === 'approved' && dayProblems(d, today, d.workDate).includes('no_clock_out')))
  const summary = active.map(e => {
    const mine = days.filter(d => d.employeeId === e.id)
    const b = basis.find(x => x.employeeId === e.id)
    const payable = payableDays(mine)
    return {
      employee: e,
      basis: b?.basis ?? 'monthly' as PayBasis,
      rate: b?.dailyRate ?? 0,
      present: mine.filter(d => d.clockIn && d.status !== 'rejected').length,
      payable,
      waiting: mine.filter(d => d.status === 'pending').length,
    }
  })

  const openEdit = (employeeId: string, workDate: string, day: AttendanceDay | null, status?: AttendanceStatus) =>
    setEditing({ employeeId, workDate, day, clockIn: toHhmm(day?.clockIn ?? null), clockOut: toHhmm(day?.clockOut ?? null), status: status ?? day?.status ?? 'approved', reason: '' })

  const saveEdit = async () => {
    if (!editing) return
    if (!editing.reason.trim()) { showToast('Give a reason for the change', 'error'); return }
    setBusy(true)
    try {
      await send('/api/attendance', 'PATCH', {
        employeeId: editing.employeeId, workDate: editing.workDate, status: editing.status, reason: editing.reason,
        clockIn: toIso(editing.workDate, editing.clockIn), clockOut: toIso(editing.workDate, editing.clockOut),
      })
      showToast('Attendance saved', 'success')
      setEditing(null)
      void load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') } finally { setBusy(false) }
  }

  const savePay = async () => {
    if (!payEdit) return
    setBusy(true)
    try {
      await send('/api/attendance/pay-basis', 'PUT', { employeeId: payEdit.employeeId, basis: payEdit.basis, dailyRate: Number(payEdit.rate) })
      showToast(`${payEdit.name}: ${payEdit.basis === 'daily' ? `paid ${fmtKes(Number(payEdit.rate))} a day` : 'monthly salary'}`, 'success')
      setPayEdit(null)
      void load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') } finally { setBusy(false) }
  }

  const addNetwork = async () => {
    setBusy(true)
    try {
      await send('/api/attendance/networks', 'POST', { label: netLabel })
      showToast('This connection now counts as the office', 'success')
      setNetLabel('')
      void load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') } finally { setBusy(false) }
  }
  const removeNetwork = async (n: Network) => {
    if (!window.confirm(`Stop treating "${n.label}" as an office connection?`)) return
    try { await send(`/api/attendance/networks?id=${encodeURIComponent(n.id)}`, 'DELETE'); void load() } catch (e) { showToast(e instanceof Error ? e.message : 'Could not remove', 'error') }
  }

  const dayLine = (d: AttendanceDay) => {
    const hours = hoursBetween(d.clockIn, d.clockOut)
    if (!d.clockIn) return 'No clock-in'
    return d.clockOut ? `${time(d.clockIn)}–${time(d.clockOut)} · ${hours.toFixed(1)}h` : `In ${time(d.clockIn)} · no clock-out yet`
  }

  return (
    <div className="hr-attendance">
      <div className="hr-attendance__bar">
        <div className="hr-attendance__tabs" role="tablist" aria-label="Attendance views">
          {([['review', `To review${toReview.length ? ` (${toReview.length})` : ''}`], ['month', 'Month'], ['office', 'Office connections']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-active' : ''} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
        {view !== 'office' && (
          <div className="hr-attendance__month">
            <input type="month" className="form-input" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />
            {!lockedBy && <button type="button" className="btn-outline" onClick={() => setEditing({ employeeId: active[0]?.id ?? '', workDate: today, day: null, clockIn: '08:00', clockOut: '17:00', status: 'approved', reason: '' })}>Add a day</button>}
          </div>
        )}
      </div>

      {lockedBy && view !== 'office' && <p className="hr-attendance__note">Payroll {lockedBy} covers this month, so its attendance can no longer change.</p>}

      {view === 'review' && (
        toReview.length === 0 ? <p className="hr-attendance__empty">Nothing to review for this month.</p> : (
          <ul className="hr-attendance__list">
            {toReview.map(d => (
              <li key={d.id}>
                <div>
                  <strong>{nameOf(d.employeeId)}</strong>
                  <span>{fmtDay(d.workDate)} · {dayLine(d)}</span>
                  <small>{dayProblems(d, today, d.workDate).map(p => PROBLEM_TEXT[p]).join(' · ') || 'Waiting for approval'}</small>
                </div>
                {!lockedBy && (
                  <div className="hr-attendance__actions">
                    <button type="button" className="btn-primary" onClick={() => openEdit(d.employeeId, d.workDate, d, 'approved')}>{d.clockOut ? 'Approve' : 'Set clock-out'}</button>
                    <button type="button" className="btn-outline" onClick={() => openEdit(d.employeeId, d.workDate, d, 'rejected')}>Reject</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {view === 'month' && (
        <div className="hr-attendance__table-wrap">
          <ul className="hr-attendance__sum">
            <li className="hr-attendance__sum-head" aria-hidden="true"><span>Employee</span><span>Paid by</span><span>Days in</span><span>Days to pay</span><span>Waiting</span><span>Pay for days</span></li>
            {summary.map(s => (
              <li key={s.employee.id}>
                <strong>{s.employee.fullName}</strong>
                <span>
                  {canPay
                    ? <button type="button" className="hr-attendance__link" onClick={() => setPayEdit({ employeeId: s.employee.id, name: s.employee.fullName, basis: s.basis, rate: s.rate ? String(s.rate) : '' })}>
                        {s.basis === 'daily' ? `${fmtKes(s.rate)} a day` : 'Monthly salary'}
                      </button>
                    : s.basis === 'daily' ? `${fmtKes(s.rate)} a day` : 'Monthly salary'}
                </span>
                <span data-label="Days in">{s.present}</span>
                <span data-label="Days to pay">{s.payable}</span>
                <span data-label="Waiting">{s.waiting || '—'}</span>
                <span data-label="Pay for days">{s.basis === 'daily' ? fmtKes(dailyPay(s.payable, s.rate)) : '—'}</span>
              </li>
            ))}
          </ul>
          <p className="hr-attendance__note">Approved days only: 6 hours or more is a full day, 3 to 6 hours a half day. Holidays and leave are not paid to daily-rate staff. Payroll uses these days when it is prepared.</p>
          <details className="hr-attendance__days">
            <summary>Every day this month ({days.length})</summary>
            <ul className="hr-attendance__list">
              {days.map(d => (
                <li key={d.id}>
                  <div>
                    <strong>{nameOf(d.employeeId)}</strong>
                    <span>{fmtDay(d.workDate)} · {dayLine(d)} · {d.status === 'approved' ? (payableValue(d) === 1 ? 'full day' : payableValue(d) === 0.5 ? 'half day' : 'not paid') : d.status === 'rejected' ? 'rejected' : 'waiting'}</span>
                    {d.history.length > 0 && <small>{d.history.map(h => `${new Date(h.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })} ${h.by}: ${h.action}${h.reason ? ` (${h.reason})` : ''}`).join(' · ')}</small>}
                  </div>
                  {!lockedBy && <div className="hr-attendance__actions"><button type="button" className="btn-outline" onClick={() => openEdit(d.employeeId, d.workDate, d)}>Change</button></div>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {view === 'office' && (
        <div className="hr-attendance__office">
          <p className="hr-attendance__note">
            A clock-in counts by itself only when it comes from one of these connections and is confirmed with the person&apos;s Face ID or fingerprint.
            To add one, open this page on a phone or computer connected to that office&apos;s Wi-Fi and tap “Use this connection”.
          </p>
          <div className={`hr-attendance__current${networks.currentIsOffice ? ' is-ok' : ''}`}>
            <span>{networks.currentIsOffice ? 'You are on an office connection' : 'This device is not on a saved office connection'}</span>
            {!networks.currentIsOffice && networks.current && (
              <div className="hr-attendance__add">
                <input className="form-input" value={netLabel} onChange={e => setNetLabel(e.target.value)} placeholder="Name, e.g. Main office Wi-Fi" />
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void addNetwork()}>Use this connection</button>
              </div>
            )}
          </div>
          {networks.list.length === 0 ? <p className="hr-attendance__empty">No office connections yet — every clock-in will wait for a supervisor.</p> : (
            <ul className="hr-attendance__list">
              {networks.list.map(n => (
                <li key={n.id}>
                  <div><strong>{n.label}</strong><span>{n.ip}{networks.current === n.ip ? ' · this device' : ''}</span></div>
                  <div className="hr-attendance__actions"><button type="button" className="btn-outline" onClick={() => void removeNetwork(n)}>Remove</button></div>
                </li>
              ))}
            </ul>
          )}
          <p className="hr-attendance__note">If the office internet provider changes the connection, clock-ins will start waiting for approval — add the new connection here the same way.</p>
        </div>
      )}

      {editing && (
        <Modal title={editing.day ? 'Change a day' : 'Add a day'} subtitle={editing.day ? `${nameOf(editing.employeeId)} · ${fmtDay(editing.workDate)}` : 'For a day someone worked but could not clock'} width={480} variant="enterprise"
          onClose={() => { if (!busy) setEditing(null) }}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void saveEdit()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          )}>
          <div className="hr-attendance__form">
            {!editing.day && (
              <>
                <label><span>Employee</span>
                  <select className="form-input" value={editing.employeeId} onChange={e => setEditing({ ...editing, employeeId: e.target.value })}>
                    {active.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                  </select>
                </label>
                <label><span>Day</span><input type="date" className="form-input" value={editing.workDate} max={today} onChange={e => setEditing({ ...editing, workDate: e.target.value })} /></label>
              </>
            )}
            <div className="hr-attendance__pair">
              <label><span>Clock-in</span><input type="time" className="form-input" value={editing.clockIn} onChange={e => setEditing({ ...editing, clockIn: e.target.value })} /></label>
              <label><span>Clock-out</span><input type="time" className="form-input" value={editing.clockOut} onChange={e => setEditing({ ...editing, clockOut: e.target.value })} /></label>
            </div>
            <div className="hr-attendance__status" role="radiogroup" aria-label="Decision">
              {(['approved', 'rejected'] as const).map(s => (
                <button key={s} type="button" role="radio" aria-checked={editing.status === s} className={editing.status === s ? 'is-active' : ''} onClick={() => setEditing({ ...editing, status: s })}>
                  {s === 'approved' ? 'Approve — count it' : 'Reject — do not pay'}
                </button>
              ))}
            </div>
            <label><span>Reason *</span><input className="form-input" value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} placeholder="e.g. At a client site; forgot to clock out" /></label>
            {editing.day && editing.day.history.length > 0 && (
              <ul className="hr-attendance__history">
                {editing.day.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })} · {h.by}: {h.action}{h.reason ? ` — ${h.reason}` : ''}</li>)}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {payEdit && (
        <Modal title="How is this person paid?" subtitle={payEdit.name} width={440} variant="enterprise" onClose={() => { if (!busy) setPayEdit(null) }}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setPayEdit(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void savePay()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          )}>
          <div className="hr-attendance__form">
            <div className="hr-attendance__status" role="radiogroup" aria-label="Paid by">
              {(['monthly', 'daily'] as const).map(b => (
                <button key={b} type="button" role="radio" aria-checked={payEdit.basis === b} className={payEdit.basis === b ? 'is-active' : ''} onClick={() => setPayEdit({ ...payEdit, basis: b })}>
                  {b === 'monthly' ? 'Monthly salary' : 'By the day'}
                </button>
              ))}
            </div>
            {payEdit.basis === 'daily' && (
              <label><span>Daily rate (KES) *</span><input type="number" inputMode="decimal" className="form-input" value={payEdit.rate} onChange={e => setPayEdit({ ...payEdit, rate: e.target.value })} placeholder="e.g. 800" /></label>
            )}
            <p className="hr-attendance__note">
              {payEdit.basis === 'daily'
                ? 'Payroll pays the approved days of the month × this rate, in place of the basic salary. Allowances on the employee record still apply.'
                : 'Payroll pays the basic salary on the employee record. Clock-ins are still kept for lateness and absence.'}
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
