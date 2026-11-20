'use client'

import { useEffect, useMemo, useState } from 'react'
import { Field, Modal, Select, Textarea } from '@/components/ui'
import { fmtDate } from '@/lib/store'
import type { SoldWithoutTrace } from '@/lib/inventory/sold-without-trace'

const LOCATIONS = [
  { value: 'warehouse', label: 'Warehouse (Main)' },
  { value: 'shop', label: 'Shop' },
  { value: 'pending_testing', label: 'Inbound — Awaiting tests' },
  { value: 'repair_unit', label: 'Repair unit' },
]

/**
 * Units marked sold that no sale names (lib/inventory/sold-without-trace.ts),
 * and putting chosen ones back into stock. A unit a sale does name never
 * appears here: it comes back through After-Sales so the books follow.
 */
export default function SoldWithoutTraceModal({ onClose, onToast }: {
  onClose: () => void
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const [units, setUnits] = useState<SoldWithoutTrace[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')
  const [location, setLocation] = useState('warehouse')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setError('')
    try {
      const res = await fetch('/api/inventory/sold-without-trace', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Could not check sold units')
      setUnits(body.units ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check sold units')
      setUnits([])
    }
  }
  useEffect(() => { void load() }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (units ?? []).filter(u => !q || `${u.serial} ${u.productName}`.toLowerCase().includes(q))
  }, [units, query])
  const allPicked = shown.length > 0 && shown.every(u => picked.has(u.id))
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const submit = async () => {
    if (!picked.size) return
    if (!reason.trim()) { setError('Say why these units are going back into stock'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/inventory/sold-without-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialIds: [...picked], reason: reason.trim(), location }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Could not return the units')
      const back = (body.returned ?? []).length
      const refused = (body.refused ?? []) as Array<{ id: string; why: string }>
      onToast(
        `${back} unit${back === 1 ? '' : 's'} back in ${LOCATIONS.find(l => l.value === location)?.label ?? location} (${body.reference})`
          + (refused.length ? ` · ${refused.length} left as sold: ${refused[0].why}` : ''),
        refused.length ? 'info' : 'success',
      )
      setPicked(new Set())
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not return the units')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Sold with no sale record"
      subtitle="Units marked sold that no sale order, delivery, invoice, POS sale, Kilimall order or warranty names"
      onClose={onClose}
      width={720}
    >
      <div className="flex flex-col gap-4">
        {units === null ? (
          <p className="text-[13px] text-[var(--text-3)]">Checking every sold unit against sales…</p>
        ) : units.length === 0 ? (
          <p className="text-[13px] text-[var(--text-3)]">{error || 'Every unit marked sold has a sale behind it.'}</p>
        ) : (
          <>
            <p className="text-[12px] text-[var(--text-3)]">
              These are still marked sold, but nothing shows they were. If they are on the shelf, put them back into stock.
              A unit a customer actually returned should go through After-Sales instead, so the sale is credited.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="input min-w-0 flex-1"
                placeholder="Find serial or product"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Find serial or product"
              />
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={() => setPicked(prev => {
                    const next = new Set(prev)
                    for (const u of shown) { if (allPicked) next.delete(u.id); else next.add(u.id) }
                    return next
                  })}
                />
                All {shown.length}
              </label>
            </div>
            <ul className="max-h-[min(22rem,calc(var(--app-h)-22rem))] divide-y divide-[var(--border-lt)] overflow-y-auto rounded-xl border border-[var(--border-lt)]">
              {shown.map(u => (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" className="mt-1" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[var(--text-1)]">{u.productName || u.productId}</span>
                      <span className="block font-mono text-[12px] text-[var(--text-2)]">{u.serial}</span>
                      <span className="block text-[11px] text-[var(--text-3)]">
                        {u.soldDate ? `Marked sold ${fmtDate(u.soldDate)}` : 'No sold date'}
                        {u.lastMove ? ` · last record: ${u.lastMove.reason || u.lastMove.documentRef}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
              <Field label="Why they are going back" required>
                <Textarea value={reason} onChange={setReason} rows={2} placeholder="e.g. Found on the shelf at stock count; never sold" />
              </Field>
              <Field label="Put them in">
                <Select value={location} onChange={setLocation} options={LOCATIONS} />
              </Field>
            </div>
            {error && <p className="text-[12px] font-semibold text-[var(--danger-text)]">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-outline" onClick={onClose}>Close</button>
              <button type="button" className="btn-primary disabled:opacity-40" disabled={!picked.size || saving} onClick={() => { void submit() }}>
                {saving ? 'Returning…' : `Return ${picked.size || ''} to stock`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
