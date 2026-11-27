'use client'

import { useState } from 'react'
import { DEFAULT_UNIT_TEST_CHECKLIST, unitTestSettings, type ChecklistItem } from '@/lib/inventory/unit-tests'

const inputCls = 'rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-[12px] text-text-1 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30'

/**
 * Settings › Inventory › Test bench: the checklist testers tick, and the
 * battery levels that fail a laptop or get called out on its label. A new
 * list applies to tests started from now on; finished tests keep theirs.
 */
export function UnitTestChecklistSettings({ settings, onChange }: {
  settings: Record<string, unknown>
  onChange: (patch: { invUnitTestChecklist?: ChecklistItem[]; invBatteryFailBelow?: number; invBatteryNoteBelow?: number }) => void
}) {
  const current = unitTestSettings(settings)
  const [draft, setDraft] = useState('')
  const list = current.checklist
  const save = (next: ChecklistItem[]) => onChange({ invUnitTestChecklist: next })
  const edit = (id: string, p: Partial<ChecklistItem>) => save(list.map(i => (i.id === id ? { ...i, ...p } : i)))
  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= list.length) return
    const next = [...list]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    save(next)
  }
  const add = () => {
    const label = draft.trim()
    if (!label) return
    const id = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${Date.now().toString(36)}`
    save([...list, { id, label, short: label.split(/\s+/)[0].slice(0, 12) }])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-3 px-1 pb-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-text-2">Fail a laptop below battery health</span>
          <span className="flex items-center gap-1">
            <input type="number" min={0} max={100} className={`${inputCls} w-24`} value={current.batteryFailBelow}
              onChange={e => onChange({ invBatteryFailBelow: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
            <span className="text-[11px] text-text-3">%</span>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-text-2">Passes, but shown on the label, below</span>
          <span className="flex items-center gap-1">
            <input type="number" min={0} max={100} className={`${inputCls} w-24`} value={current.batteryNoteBelow}
              onChange={e => onChange({ invBatteryNoteBelow: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
            <span className="text-[11px] text-text-3">%</span>
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-[var(--border-lt)] divide-y divide-[var(--border-lt)]">
        {list.map((i, n) => (
          <div key={i.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${i.inactive ? 'opacity-55' : ''}`}>
            <div className="flex flex-col">
              <button type="button" className="text-[10px] text-text-3 hover:text-text-1 leading-none px-1" aria-label={`Move ${i.label} up`} onClick={() => move(n, -1)} disabled={n === 0}>▲</button>
              <button type="button" className="text-[10px] text-text-3 hover:text-text-1 leading-none px-1" aria-label={`Move ${i.label} down`} onClick={() => move(n, 1)} disabled={n === list.length - 1}>▼</button>
            </div>
            <input className={`${inputCls} flex-1 min-w-[180px]`} value={i.label} aria-label="Check" onChange={e => edit(i.id, { label: e.target.value })} />
            <input className={`${inputCls} w-28`} value={i.short} aria-label="Label text" title="Shown in the label's tick strip" maxLength={12} onChange={e => edit(i.id, { short: e.target.value })} />
            <label className="flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={!!i.laptopOnly} onChange={e => edit(i.id, { laptopOnly: e.target.checked })} /> Laptops only
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={!i.inactive} onChange={e => edit(i.id, { inactive: !e.target.checked })} /> In use
            </label>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} flex-1 min-w-[200px]`} value={draft} placeholder="Add a check — e.g. Fan & thermals" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button type="button" className="btn-secondary text-[12px]" onClick={add} disabled={!draft.trim()}>Add check</button>
        <button type="button" className="btn-outline text-[12px]" onClick={() => save(DEFAULT_UNIT_TEST_CHECKLIST)}>Reset to default</button>
      </div>
      <p className="text-[11px] text-text-3">Changes apply to tests started from now on. Finished tests keep the checklist they were done with. Untick “In use” rather than deleting, so old reports still read.</p>
    </div>
  )
}
