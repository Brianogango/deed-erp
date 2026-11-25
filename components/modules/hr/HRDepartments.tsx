'use client'

import { useCallback, useEffect, useState } from 'react'

type Dept = { id: string; name: string; description: string; active: boolean; people: number }
type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void

async function send(method: string, body: unknown) {
  const res = await fetch('/api/departments', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not save')
  return data
}

/** The department list employees are filed under: add, rename, switch off. */
export default function HRDepartments({ canManage, showToast, onChanged }: { canManage: boolean; showToast: Toast; onChanged?: () => void }) {
  const [rows, setRows] = useState<Dept[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
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
    finally { setBusy(false) }
  }

  const shown = rows.filter(d => d.active || showOff)
  const offCount = rows.filter(d => !d.active).length

  return (
    <div className="hr-depts">
      {canManage && (
        <form className="hr-depts__add" onSubmit={e => { e.preventDefault(); if (name.trim()) void act('POST', { name }, `${name.trim()} added`).then(() => setName('')) }}>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="New department, e.g. Customer Care" aria-label="New department name" />
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>Add department</button>
        </form>
      )}
      <ul className="hr-depts__list">
        {shown.map(d => (
          <li key={d.id} className={d.active ? '' : 'is-off'}>
            {editing?.id === d.id ? (
              <form className="hr-depts__rename" onSubmit={e => { e.preventDefault(); void act('PATCH', { id: d.id, name: editing.name }, 'Renamed').then(() => setEditing(null)) }}>
                <input className="form-input" value={editing.name} onChange={e => setEditing({ id: d.id, name: e.target.value })} autoFocus aria-label="Department name" />
                <button type="submit" className="btn-primary" disabled={busy}>Save</button>
                <button type="button" className="btn-outline" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <div>
                  <strong>{d.name}</strong>
                  <span>{d.active ? `${d.people} ${d.people === 1 ? 'person' : 'people'}` : 'Switched off'}</span>
                </div>
                {canManage && (
                  <div className="hr-depts__actions">
                    <button type="button" className="btn-outline" onClick={() => setEditing({ id: d.id, name: d.name })}>Rename</button>
                    {d.active
                      ? <button type="button" className="btn-outline" disabled={busy || d.people > 0} title={d.people > 0 ? 'Move its people to another department first' : undefined} onClick={() => void act('PATCH', { id: d.id, active: false }, `${d.name} switched off`)}>Switch off</button>
                      : <button type="button" className="btn-outline" disabled={busy} onClick={() => void act('PATCH', { id: d.id, active: true }, `${d.name} back on`)}>Switch on</button>}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {offCount > 0 && (
        <button type="button" className="hr-depts__toggle" onClick={() => setShowOff(v => !v)}>{showOff ? 'Hide switched-off departments' : `Show ${offCount} switched-off department${offCount === 1 ? '' : 's'}`}</button>
      )}
      <p className="hr-depts__note">A department can be switched off once nobody is in it. Renaming moves everyone with it.</p>
    </div>
  )
}
