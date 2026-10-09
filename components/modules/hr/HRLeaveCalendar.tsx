'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, PanelHeader } from '@/components/ui'
import { builtInPublicHolidays, isPublicHolidayIso, registerExtraPublicHolidays } from '@/lib/leave-utils'

interface Holiday { id: string; date: string; name: string }

/** Loads HR-added holidays once and feeds them to the leave day calculators. */
export function usePublicHolidays() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [version, setVersion] = useState(0)
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/public-holidays', { cache: 'no-store' })
      if (!res.ok) return
      const rows = (await res.json()) as Holiday[]
      registerExtraPublicHolidays(rows.map(r => r.date))
      setHolidays(rows)
      setVersion(v => v + 1)
    } catch { /* built-in holidays still apply */ }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { holidays, reload, version }
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function HRLeaveCalendar({ canManage, holidays, onChanged, version }: { canManage: boolean; holidays: Holiday[]; onChanged: () => void; version: number }) {
  const { showToast } = useApp()
  const { employees, leaveRequests } = useHrStore()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [form, setForm] = useState({ date: '', name: '' })

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Monday first

  const approved = useMemo(() => leaveRequests.filter(r => r.status === 'approved'), [leaveRequests])
  const nameOf = (id: string) => employees.find(e => e.id === id)?.fullName.split(' ')[0] ?? '?'
  const holidayName = (d: string) => holidays.find(h => h.date === d)?.name

  const onLeave = (d: string) => approved.filter(r => r.startDate <= d && r.endDate >= d)

  const shift = (delta: number) => {
    const m = month + delta
    if (m < 0) { setMonth(11); setYear(year - 1) } else if (m > 11) { setMonth(0); setYear(year + 1) } else setMonth(m)
  }

  const addHoliday = async (date: string, name: string) => {
    const res = await fetch('/api/hr/public-holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, name }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(body?.error || 'Holiday was not saved', 'error'); return false }
    return true
  }

  const submit = async () => {
    if (!form.date || !form.name.trim()) { showToast('Enter the date and the holiday name', 'error'); return }
    if (await addHoliday(form.date, form.name.trim())) { setForm({ date: '', name: '' }); onChanged() }
  }

  const removeHoliday = async (id: string) => {
    const res = await fetch(`/api/hr/public-holidays?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('Could not remove the holiday', 'error'); return }
    onChanged()
  }

  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const yearHolidays = holidays.filter(h => h.date.startsWith(String(year)))

  return (
    <div className="hr-submodule-panel card overflow-hidden" data-v={version}>
      <PanelHeader title="Team Leave Calendar" count={0}>
        <button className="btn-outline text-[11px]" onClick={() => shift(-1)}>‹</button>
        <span className="text-[12px] font-semibold" style={{ minWidth: 110, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button className="btn-outline text-[11px]" onClick={() => shift(1)}>›</button>
      </PanelHeader>
      <div className="p-3">
        <div className="grid grid-cols-7 gap-1 text-[10px] font-bold mb-1" style={{ color: 'var(--text-4)' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} />
            const d = iso(year, month, day)
            const people = onLeave(d)
            const holiday = isPublicHolidayIso(d)
            const sunday = new Date(year, month, day).getDay() === 0
            return (
              <div key={d} className="rounded-md p-1 min-h-[54px] text-[10px]" style={{ border: '1px solid var(--border-lt)', background: holiday ? 'var(--warning-bg)' : sunday ? 'var(--bg-muted)' : 'transparent' }}>
                <div className="font-semibold" style={{ color: holiday ? 'var(--warning-text)' : 'var(--text-3)' }}>{day}</div>
                {holiday && <div style={{ color: 'var(--warning-text)' }}>{holidayName(d) ?? 'Holiday'}</div>}
                {people.slice(0, 3).map(r => <div key={r.id} className="truncate" style={{ color: 'var(--success-text)' }} title={`${r.employeeName}: ${r.leaveType}`}>{nameOf(r.employeeId)}</div>)}
                {people.length > 3 && <div style={{ color: 'var(--text-4)' }}>+{people.length - 3} more</div>}
              </div>
            )
          })}
        </div>
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-4)' }}>Green names are on approved leave. Shaded days are public holidays or Sundays.</p>

        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-lt)' }}>
          <h4 className="text-xs font-bold mb-2" style={{ color: 'var(--text-1)' }}>Public holidays {year}</h4>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>
            Built in: {builtInPublicHolidays(year).sort().map(d => fmtDate(d)).join(', ')}.
            Add gazetted days that move each year (Idd-ul-Fitr, Idd-ul-Azha) or special public holidays so leave day counts exclude them.
          </p>
          {yearHolidays.map(h => (
            <div key={h.id} className="flex items-center justify-between text-xs py-1">
              <span>{fmtDate(h.date)} · {h.name}</span>
              {canManage && <button className="text-[10px]" style={{ color: 'var(--danger)' }} onClick={() => removeHoliday(h.id)}>Remove</button>}
            </div>
          ))}
          {canManage && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 items-end">
              <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} /></Field>
              <Field label="Name"><Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Idd-ul-Fitr" /></Field>
              <button className="btn-primary text-[11px]" onClick={submit}>Add holiday</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
