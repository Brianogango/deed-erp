'use client'

import { useCallback, useEffect, useState } from 'react'
import { fmtKes } from '@/lib/store'

type Dept = { id: string; name: string; description: string; active: boolean; people: number; headEmployeeId?: string | null }
type Person = { id: string; fullName: string; departmentId: string; status: string; basicSalary: number; housingAllowance?: number; transportAllowance?: number }
type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void

async function send(method: string, body: unknown) {
  const res = await fetch('/api/departments', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not save')
  return data
}

const short = (name: string) => { const [a, b] = name.split(/\s+/); return b ? `${a} ${b[0]}.` : a }

/**
 * HR mock E: departments with their head, how many people, and what they
 * cost a month — add one at the top; rename, set head or switch off in ⋯.
 */
export default function HRDepartments({ canManage, showToast, onChanged, employees, payBasis, canSeePay }: {
  canManage: boolean
  showToast: Toast
  onChanged?: () => void
  employees: Person[]
  payBasis: Map<string, { basis: 'monthly' | 'daily'; dailyRate: number }>
  canSeePay: boolean
}) {
  const [rows, setRows] = useState<Dept[]>([])
  const [name, setName] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [heading, setHeading] = useState<string | null>(null)
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/departments', { cache: 'no-store' })
      const d = await r.json()
      if (Array.isArray(d.departments)) setRows(d.departments)
    } catch { /* offline */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (method: string, body: unknown, done: string) => {
    setBusy(true)
    try { await send(method, body); showToast(done, 'success'); await load(); onChanged?.() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') }
    finally { setBusy(false); setMenu(null) }
  }

  const active = employees.filter(e => e.status !== 'exited')
  const inDept = (d: Dept) => active.filter(e => e.departmentId === d.id || e.departmentId === d.name)
  const monthly = (people: Person[]) => people.reduce((t, e) => {
    const b = payBasis.get(e.id)
    if (b?.basis === 'daily' && b.dailyRate > 0) return t + b.dailyRate * 22
    return t + Number(e.basicSalary || 0) + Number(e.housingAllowance || 0) + Number(e.transportAllowance || 0)
  }, 0)
  const live = rows.filter(d => d.active)
  const off = rows.filter(d => !d.active)
  const shown = showOff ? rows : live
  const total = live.reduce((t, d) => t + inDept(d).length, 0)
  const max = Math.max(1, ...live.map(d => inDept(d).length))

  return (
    <section className="hra-card hre">
      <div className="hra-ch">
        <b className="hrc-title">{live.length} department{live.length === 1 ? '' : 's'} · {total} {total === 1 ? 'person' : 'people'}</b>
        {canManage && (
          <form className="hre-add" onSubmit={e => { e.preventDefault(); if (name.trim()) void act('POST', { name }, `${name.trim()} added`).then(() => setName('')) }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="New department…" aria-label="New department name" />
            <button type="submit" className="hrb-btn is-p" disabled={busy || !name.trim()}>Add</button>
          </form>
        )}
      </div>
      <div className="hra-table-wrap">
        <table className="hra-table">
          <thead><tr><th>Department</th><th>Head</th><th className="hre-people">People</th>{canSeePay && <th className="hra-r">Monthly pay</th>}<th /></tr></thead>
          <tbody>
            {shown.map(d => {
              const people = inDept(d)
              const head = employees.find(e => e.id === d.headEmployeeId)
              return (
                <tr key={d.id} className={`is-static${d.active ? '' : ' hre-off'}`}>
                  <td>
                    {editing?.id === d.id ? (
                      <form className="hre-inline" onSubmit={e => { e.preventDefault(); void act('PATCH', { id: d.id, name: editing.name }, 'Renamed').then(() => setEditing(null)) }}>
                        <input value={editing.name} autoFocus onChange={e => setEditing({ id: d.id, name: e.target.value })} aria-label="Department name" />
                        <button type="submit" className="hrb-btn is-p" disabled={busy}>Save</button>
                        <button type="button" className="hrb-btn" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    ) : <b className={d.active ? '' : 'hrc-muted'}>{d.name}</b>}
                  </td>
                  <td>
                    {heading === d.id ? (
                      <select className="hre-select" autoFocus value={d.headEmployeeId ?? ''} onBlur={() => setHeading(null)}
                        onChange={e => { setHeading(null); void act('PATCH', { id: d.id, headEmployeeId: e.target.value || null }, e.target.value ? 'Head set' : 'Head cleared') }}>
                        <option value="">No head</option>
                        {active.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                      </select>
                    ) : head ? short(head.fullName) : '—'}
                  </td>
                  <td className="hre-people">
                    {d.active && people.length > 0
                      ? <div className="hre-bar-row"><div className="hra-bar hre-bar"><i style={{ width: `${Math.round((people.length / max) * 100)}%` }} /></div><b>{people.length}</b></div>
                      : <span className="hrc-muted">{d.active ? 'No one yet' : 'Switched off'}</span>}
                  </td>
                  {canSeePay && <td className="hra-r">{people.length ? fmtKes(monthly(people)) : <span className="hrc-muted">—</span>}</td>}
                  <td className="hra-r hre-menu-cell">
                    {canManage && (
                      <>
                        <button type="button" className="hre-dots" aria-label={`${d.name} actions`} aria-expanded={menu === d.id} onClick={() => setMenu(menu === d.id ? null : d.id)}>⋯</button>
                        {menu === d.id && (
                          <div className="hre-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing({ id: d.id, name: d.name }) }}>Rename</button>
                            {d.active && <button type="button" role="menuitem" onClick={() => { setMenu(null); setHeading(d.id) }}>Set head</button>}
                            {d.active
                              ? <button type="button" role="menuitem" disabled={busy || people.length > 0} title={people.length ? 'Move its people to another department first' : undefined} onClick={() => void act('PATCH', { id: d.id, active: false }, `${d.name} switched off`)}>Switch off{people.length ? ' (only when empty)' : ''}</button>
                              : <button type="button" role="menuitem" disabled={busy} onClick={() => void act('PATCH', { id: d.id, active: true }, `${d.name} back on`)}>Switch on</button>}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hre-foot">
        ⋯ = Rename · Set head · Switch off (only when empty).
        {off.length > 0 && <> Switched-off departments: <button type="button" className="hrd-link" onClick={() => setShowOff(v => !v)}>{off.length}{showOff ? ' (hide)' : ' (show)'}</button></>}
        {canSeePay && ' Daily-rate pay is counted at 22 days.'}
      </p>
    </section>
  )
}
