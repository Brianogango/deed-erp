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
  const { employees, leaveRequests } = useHrStore()
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
  const [view, setView] = useState<'today' | 'month' | 'office'>('today')
  const [leftAt, setLeftAt] = useState<Record<string, string>>({})
  const [countAs, setCountAs] = useState<Record<string, 'full' | 'half' | 'none'>>({})

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

  // ── HR mock G: who is in today, and each problem day on a time bar ──
  const OFFICE_START = 8, OFFICE_END = 17, BAR_FROM = 7, BAR_TO = 19
  const hourOf = (iso: string | null) => {
    if (!iso) return null
    const [h, m] = time(iso).split(':').map(Number)
    return h + m / 60
  }
  const pct = (h: number) => `${Math.max(0, Math.min(100, ((h - BAR_FROM) / (BAR_TO - BAR_FROM)) * 100))}%`
  const todays = days.filter(d => d.workDate === today)
  const onLeave = new Set(leaveRequests.filter(r => r.status === 'approved' && r.startDate <= today && r.endDate >= today).map(r => r.employeeId))
  const board = active.map(e => {
    const d = todays.find(x => x.employeeId === e.id)
    const inAt = hourOf(d?.clockIn ?? null)
    const state = onLeave.has(e.id) ? 'leave' : !d?.clockIn ? 'out' : inAt !== null && inAt > OFFICE_START + 0.25 ? 'late' : 'in'
    const how = d ? (d.inVerified ? 'fingerprint' : d.inOffice ? 'office' : 'outside') : ''
    return { e, d, state, how }
  })
  const count = (st: string) => board.filter(b => b.state === st).length
  const short = (name: string) => { const [a1, b1] = name.split(/\s+/); return b1 ? `${a1} ${b1[0]}.` : a1 }
  const ini = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  const color = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ['#db2777', '#2563eb', '#0d9488', '#ea580c', '#7c3aed', '#0891b2', '#b45309', '#4f46e5'][h % 8] }
  const [boardAll, setBoardAll] = useState(false)
  const shownBoard = boardAll ? board : board.slice(0, 7)

  // A day's value from its hours, as payroll counts it.
  const valueOf = (d: AttendanceDay, out?: string) => {
    const end = out ? toIso(d.workDate, out) : d.clockOut
    const h = hoursBetween(d.clockIn, end)
    return h >= 6 ? 'full' : h >= 3 ? 'half' : 'none'
  }
  const decide = async (d: AttendanceDay, approve: boolean, auto = false) => {
    const out = leftAt[d.id]
    const choice = countAs[d.id] ?? valueOf(d, out)
    const reject = !approve || choice === 'none'
    setBusy(true)
    try {
      await send('/api/attendance', 'PATCH', {
        employeeId: d.employeeId, workDate: d.workDate, status: reject ? 'rejected' : 'approved',
        reason: reject ? 'Not worked — reviewed by supervisor' : auto ? 'Approved in bulk: hours look fine' : out && !d.clockOut ? `Left at ${out} (set by supervisor)` : 'Approved by supervisor',
        clockIn: d.clockIn, clockOut: out && !d.clockOut ? toIso(d.workDate, out) : d.clockOut,
      })
      if (!auto) showToast(reject ? 'Day marked not worked' : 'Day approved', 'success')
      return true
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error'); return false } finally { setBusy(false) }
  }
  const fine = toReview.filter(d => d.status === 'pending' && d.clockOut && hoursBetween(d.clockIn, d.clockOut) >= 3)
  const approveFine = async () => {
    let ok = 0
    for (const d of fine) if (await decide(d, true, true)) ok += 1
    showToast(`${ok} day${ok === 1 ? '' : 's'} approved`, 'success')
    void load()
  }

  return (
    <div className="hr-attendance hrg">
      {view === 'today' && (
        <>
          <section className="hra-card">
            <div className="hra-ch">
              <div><b className="hrc-title">Today · {fmtDay(today)}</b><div className="hrg-sub">Office day 08:00 – 17:00</div></div>
              <div className="hrf-tools">
                <button type="button" className="hrb-btn" onClick={() => setView('month')}>Month ▾</button>
                <button type="button" className="hrb-btn" onClick={() => setView('office')}>⚙ Office connections</button>
              </div>
            </div>
            <div className="hrg-chips">
              <span className="hra-chip is-g">In · {count('in')}</span>
              <span className="hra-chip is-a">Late · {count('late')}</span>
              <span className="hra-chip is-s">Not in · {count('out')}</span>
              <span className="hra-chip is-b">On leave · {count('leave')}</span>
            </div>
            <div className="hrg-board">
              {shownBoard.map(({ e, d, state, how }) => (
                <div key={e.id} className="hrg-pp">
                  <span className="hrg-av" style={{ background: color(e.fullName) }}>{ini(e.fullName)}<i className={`is-${state}`} /></span>
                  <div className="min-w-0">
                    <b>{short(e.fullName)}</b>
                    <small className={state === 'late' ? 'is-late' : ''}>
                      {state === 'leave' ? 'On leave' : state === 'out' ? 'Not in yet' : `In ${time(d!.clockIn)} · ${state === 'late' ? 'late' : how}`}
                    </small>
                  </div>
                </div>
              ))}
              {!boardAll && board.length > 7 && (
                <button type="button" className="hrg-pp hrg-more" onClick={() => setBoardAll(true)}>+ {board.length - 7} more</button>
              )}
            </div>
          </section>

          <section className="hra-card">
            <div className="hra-ch">
              <div><b className="hrc-title">{toReview.length ? `${toReview.length} day${toReview.length === 1 ? '' : 's'} need your decision` : 'No days need a decision'}</b><div className="hrg-sub">They are not paid until approved</div></div>
              {!lockedBy && fine.length > 0 && <button type="button" className="hrb-btn is-g" disabled={busy} onClick={() => void approveFine()}>Approve all that look fine</button>}
            </div>
            {lockedBy && <p className="hrb-empty">Payroll {lockedBy} covers this month, so its attendance can no longer change.</p>}
            {toReview.map(d => {
              const inH = hourOf(d.clockIn)
              const outH = d.clockOut ? hourOf(d.clockOut) : leftAt[d.id] ? Number(leftAt[d.id].split(':')[0]) + Number(leftAt[d.id].split(':')[1]) / 60 : null
              const problems = dayProblems(d, today, d.workDate)
              const mins = d.clockIn && d.clockOut ? Math.round((new Date(d.clockOut).getTime() - new Date(d.clockIn).getTime()) / 60000) : null
              const value = countAs[d.id] ?? valueOf(d, leftAt[d.id])
              const hours = hoursBetween(d.clockIn, leftAt[d.id] && !d.clockOut ? toIso(d.workDate, leftAt[d.id]) : d.clockOut)
              return (
                <div key={d.id} className="hrg-rv">
                  <div className="hra-who"><span className="hra-av" style={{ background: color(nameOf(d.employeeId)) }}>{ini(nameOf(d.employeeId))}</span><div className="min-w-0"><b>{nameOf(d.employeeId)}</b><small>{fmtDay(d.workDate)}</small></div></div>
                  <div className="min-w-0">
                    <div className="hrg-tl">
                      <div className="hrg-work" style={{ left: pct(OFFICE_START), width: `calc(${pct(OFFICE_END)} - ${pct(OFFICE_START)})` }} />
                      {inH !== null && (
                        <div className={`hrg-seg${d.clockOut || leftAt[d.id] ? '' : ' is-open'}`}
                          style={{ left: pct(inH), width: `max(4px, calc(${pct(outH ?? OFFICE_END)} - ${pct(inH)}))` }} />
                      )}
                    </div>
                    <div className="hrg-ticks"><span>7</span><span>9</span><span>11</span><span>13</span><span>15</span><span>17</span><span>19</span></div>
                    <div className="hrg-flags">
                      {mins !== null && mins < 60 && <span className="hra-chip is-r">Only {mins} minute{mins === 1 ? '' : 's'}</span>}
                      {problems.map(pr => (
                        <span key={pr} className={`hra-chip ${pr === 'no_clock_out' ? 'is-r' : pr === 'outside_office' ? 'is-a' : 'is-s'}`}>
                          {pr === 'no_clock_out' ? 'Never clocked out' : pr === 'outside_office' ? 'Off office Wi-Fi' : pr === 'no_fingerprint' ? 'No fingerprint' : PROBLEM_TEXT[pr]}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!lockedBy && (
                    <div className="hrg-dec">
                      {d.clockOut ? (
                        <div className="hra-seg" role="radiogroup" aria-label="Counts as">
                          {([['full', 'Full day'], ['half', 'Half'], ['none', 'Not worked']] as const).map(([v, l]) => {
                            const possible = v === 'none' || (v === 'half' ? hours >= 3 : hours >= 6)
                            return <button key={v} type="button" role="radio" aria-checked={value === v} aria-selected={value === v} disabled={!possible} title={possible ? undefined : 'The hours clocked are too few for this'} onClick={() => setCountAs(c => ({ ...c, [d.id]: v }))}>{l}</button>
                          })}
                        </div>
                      ) : (
                        <label className="hrg-left"><span>Left at</span><input type="time" value={leftAt[d.id] ?? ''} onChange={e => setLeftAt(m => ({ ...m, [d.id]: e.target.value }))} /></label>
                      )}
                      <div className="hrg-btns">
                        <button type="button" className="hrb-btn" disabled={busy} onClick={() => void decide(d, false).then(ok => { if (ok) void load() })}>Reject</button>
                        <button type="button" className="hrb-btn is-g" disabled={busy || (!d.clockOut && !leftAt[d.id])} onClick={() => void decide(d, true).then(ok => { if (ok) void load() })}>
                          {!d.clockOut ? (leftAt[d.id] ? (value === 'none' ? 'Mark not worked' : `Approve ${hours.toFixed(1)} h`) : 'Approve') : value === 'none' ? 'Mark not worked' : 'Approve'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        </>
      )}

      {view !== 'today' && (
        <div className="hr-attendance__bar">
          <button type="button" className="hrb-btn" onClick={() => setView('today')}>‹ Today</button>
          {view === 'month' && (
            <div className="hr-attendance__month">
              <input type="month" className="form-input" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              {!lockedBy && <button type="button" className="btn-outline" onClick={() => setEditing({ employeeId: active[0]?.id ?? '', workDate: today, day: null, clockIn: '08:00', clockOut: '17:00', status: 'approved', reason: '' })}>Add a day</button>}
            </div>
          )}
        </div>
      )}

      {lockedBy && view === 'month' && <p className="hr-attendance__note">Payroll {lockedBy} covers this month, so its attendance can no longer change.</p>}

      {view === 'month' && (
        <div className="hr-attendance__table-wrap">
          <ul className="hr-attendance__sum">
            <li className="hr-attendance__sum-head" aria-hidden="true"><span>Employee</span><span>Paid by</span><span>Days in</span><span>Days to pay</span><span>Waiting</span><span>Pay for days</span></li>
            {summary.map(s => (
              <li key={s.employee.id}>
                <strong>{s.employee.fullName}</strong>
                {/* Monthly salary is the default and was repeating, in link
                    blue, on every row. It is muted now; daily rate is the
                    exception these day counts actually drive, so that is what
                    carries the weight. */}
                <span>
                  {canPay
                    ? <button
                        type="button"
                        className={`hr-attendance__link${s.basis === 'daily' ? '' : ' is-default'}`}
                        onClick={() => setPayEdit({ employeeId: s.employee.id, name: s.employee.fullName, basis: s.basis, rate: s.rate ? String(s.rate) : '' })}
                      >
                        {s.basis === 'daily' ? `${fmtKes(s.rate)} a day` : 'Monthly salary'}
                      </button>
                    : <span className={s.basis === 'daily' ? undefined : 'hr-attendance__muted'}>
                        {s.basis === 'daily' ? `${fmtKes(s.rate)} a day` : 'Monthly salary'}
                      </span>}
                </span>
                {/* A grid of full-strength zeros hides the one row that has a
                    number in it. Zero is context; anything else is the news. */}
                <span data-label="Days in" className={s.present ? 'hr-attendance__num' : 'hr-attendance__num is-zero'}>{s.present}</span>
                <span data-label="Days to pay" className={s.payable ? 'hr-attendance__num' : 'hr-attendance__num is-zero'}>{s.payable}</span>
                <span data-label="Waiting" className={s.waiting ? 'hr-attendance__num is-waiting' : 'hr-attendance__num is-zero'}>{s.waiting || '—'}</span>
                <span data-label="Pay for days" className={s.basis === 'daily' ? 'hr-attendance__num' : 'hr-attendance__num is-zero'}>{s.basis === 'daily' ? fmtKes(dailyPay(s.payable, s.rate)) : '—'}</span>
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
