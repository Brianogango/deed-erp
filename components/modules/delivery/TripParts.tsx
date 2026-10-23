'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui'
import {
  carriedItems, hasStops, jobStops, openFollowUps, STOP_KIND_LABELS, stopProgress, stopsFinished, tripCashTotal,
  UNPLANNED_REASON_LABELS, type Stop, type StopKind, type TripJob,
} from '@/lib/delivery/trip'

/** One stop as typed in the office's form. */
export type StopDraft = {
  key: string
  kind: StopKind
  address: string
  contactName: string
  contactPhone: string
  notes: string
  items: Array<{ key: string; direction: 'out' | 'in'; description: string; serial: string; qty: string }>
}

const key = () => Math.random().toString(36).slice(2, 10)
export const emptyStop = (over: Partial<StopDraft> = {}): StopDraft => ({
  key: key(), kind: 'drop', address: '', contactName: '', contactPhone: '', notes: '', items: [], ...over,
})
export const emptyItem = (direction: 'out' | 'in') => ({ key: key(), direction, description: '', serial: '', qty: '1' })

/** Drop off hands items over, collect brings them back; an exchange line says which. */
const directionFor = (kind: StopKind, d: 'out' | 'in') => (kind === 'drop' ? 'out' : kind === 'collect' ? 'in' : d)

export function stopsToDrafts(stops: Stop[]): StopDraft[] {
  return stops.map(s => ({
    key: s.id, kind: s.kind, address: s.address, contactName: s.contactName ?? '', contactPhone: s.contactPhone ?? '', notes: s.notes ?? '',
    items: s.items.filter(i => !i.unplanned).map(i => ({ key: i.id, direction: i.direction, description: i.description, serial: i.serial ?? '', qty: String(i.qty) })),
  }))
}

/** Stops to save, or the first problem to show. */
export function draftsToStops(drafts: StopDraft[]): { stops: Stop[] } | { error: string } {
  const stops: Stop[] = []
  for (const [n, d] of drafts.entries()) {
    if (!d.address.trim()) return { error: `Stop ${n + 1}: enter the address` }
    const items = d.items.filter(i => i.description.trim())
    if (d.kind === 'exchange' && !(items.some(i => i.direction === 'out') && items.some(i => i.direction === 'in'))) {
      return { error: `Stop ${n + 1}: an exchange needs an item to give and an item to take back` }
    }
    stops.push({
      id: d.key,
      kind: d.kind,
      address: d.address.trim(),
      contactName: d.contactName.trim() || undefined,
      contactPhone: d.contactPhone.trim() || undefined,
      notes: d.notes.trim() || undefined,
      status: 'pending',
      items: items.map(i => ({
        id: i.key,
        direction: directionFor(d.kind, i.direction),
        description: i.description.trim(),
        serial: i.serial.trim() || undefined,
        qty: Math.max(1, Math.round(Number(i.qty) || 1)),
      })),
    })
  }
  return { stops }
}

const box = 'form-input text-xs w-full'

export function StopsEditor({ stops, onChange }: { stops: StopDraft[]; onChange: (s: StopDraft[]) => void }) {
  const set = (i: number, patch: Partial<StopDraft>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const setItem = (i: number, k: number, patch: Partial<StopDraft['items'][number]>) =>
    set(i, { items: stops[i].items.map((it, j) => (j === k ? { ...it, ...patch } : it)) })
  const move = (i: number, by: number) => {
    const next = [...stops]
    const [s] = next.splice(i, 1)
    next.splice(i + by, 0, s)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {stops.map((s, i) => (
        <div key={s.key} className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold" style={{ color: 'var(--navy)' }}>Stop {i + 1}</span>
            <div className="flex gap-1">
              {(Object.keys(STOP_KIND_LABELS) as StopKind[]).map(k => (
                <button key={k} type="button" onClick={() => set(i, { kind: k })}
                  className="text-[10px] px-2 py-1 rounded font-semibold"
                  style={{
                    background: s.kind === k ? 'var(--navy)' : 'var(--bg-muted)',
                    color: s.kind === k ? '#fff' : 'var(--text-3)',
                    border: '1px solid var(--border-lt)',
                  }}>
                  {STOP_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {i > 0 && <button type="button" className="text-[10px] text-t3" onClick={() => move(i, -1)} aria-label="Move up">↑</button>}
            {i < stops.length - 1 && <button type="button" className="text-[10px] text-t3" onClick={() => move(i, 1)} aria-label="Move down">↓</button>}
            {stops.length > 1 && (
              <button type="button" className="text-[10px]" style={{ color: 'var(--danger)' }} onClick={() => onChange(stops.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>
          <input className={box} value={s.address} onChange={e => set(i, { address: e.target.value })} placeholder="Address *" />
          <div className="grid grid-cols-2 gap-2">
            <input className={box} value={s.contactName} onChange={e => set(i, { contactName: e.target.value })} placeholder="Contact person" />
            <input className={box} type="tel" value={s.contactPhone} onChange={e => set(i, { contactPhone: e.target.value })} placeholder="Phone" maxLength={20} />
          </div>
          <div className="space-y-1">
            {s.items.map((it, k) => (
              <div key={it.key} className="grid gap-1 items-center" style={{ gridTemplateColumns: s.kind === 'exchange' ? '90px 1fr 110px 48px 20px' : '1fr 110px 48px 20px' }}>
                {s.kind === 'exchange' && (
                  <select className={box} value={it.direction} onChange={e => setItem(i, k, { direction: e.target.value as 'out' | 'in' })} aria-label="Give or take back">
                    <option value="out">Give</option>
                    <option value="in">Take back</option>
                  </select>
                )}
                <input className={box} value={it.description} onChange={e => setItem(i, k, { description: e.target.value })}
                  placeholder={directionFor(s.kind, it.direction) === 'out' ? 'Item to give' : 'Item to bring back'} />
                <input className={box} value={it.serial} onChange={e => setItem(i, k, { serial: e.target.value })} placeholder="Serial" />
                <input className={box} inputMode="numeric" value={it.qty} onChange={e => setItem(i, k, { qty: e.target.value.replace(/\D/g, '').slice(0, 3) })} aria-label="Qty" />
                <button type="button" className="text-[11px]" style={{ color: 'var(--danger)' }} onClick={() => set(i, { items: s.items.filter((_, j) => j !== k) })} aria-label="Remove item">×</button>
              </div>
            ))}
            <div className="flex gap-3">
              <button type="button" className="text-[10px] font-semibold" style={{ color: 'var(--navy)' }}
                onClick={() => set(i, { items: [...s.items, emptyItem(s.kind === 'collect' ? 'in' : 'out')] })}>
                + {s.kind === 'collect' ? 'Item to bring back' : s.kind === 'exchange' ? 'Item to give' : 'Item'}
              </button>
              {s.kind === 'exchange' && (
                <button type="button" className="text-[10px] font-semibold" style={{ color: 'var(--navy)' }}
                  onClick={() => set(i, { items: [...s.items, emptyItem('in')] })}>+ Item to take back</button>
              )}
            </div>
          </div>
          <input className={box} value={s.notes} onChange={e => set(i, { notes: e.target.value })} placeholder="Note for this stop (gate, floor, who to ask)" />
        </div>
      ))}
      <button type="button" className="btn-outline text-[11px]" onClick={() => onChange([...stops, emptyStop()])}>+ Add stop</button>
    </div>
  )
}

export function EditStopsModal({ job, onSave, onClose }: { job: TripJob; onSave: (stops: Stop[]) => void; onClose: () => void }) {
  const [drafts, setDrafts] = useState<StopDraft[]>(() => stopsToDrafts(jobStops(job)))
  const [error, setError] = useState('')
  return (
    <Modal title={`Stops — ${job.ref}`} subtitle="Where the rider goes, in order, and what to give or bring back at each stop" onClose={onClose} width={640}>
      <StopsEditor stops={drafts} onChange={setDrafts} />
      {error && <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" onClick={() => {
          const r = draftsToStops(drafts)
          if ('error' in r) { setError(r.error); return }
          onSave(r.stops)
          onClose()
        }}>Save stops</button>
      </div>
    </Modal>
  )
}

async function tripAction(jobId: string, body: Record<string, unknown>): Promise<{ job?: TripJob; error?: string }> {
  const res = await fetch(`/api/delivery-jobs/${encodeURIComponent(jobId)}/trip`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  return res.ok ? { job: out.job } : { error: out.error || 'Could not save. Try again.' }
}

/** Office: tick what the rider brought back. */
export function CheckInModal({ job, onDone, onClose }: { job: TripJob; onDone: (job: TripJob) => void; onClose: () => void }) {
  const items = carriedItems(job)
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(i => [i.id, true])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true); setError('')
    const r = await tripAction(job.id, { action: 'confirm_return', itemIds: items.filter(i => ticked[i.id]).map(i => i.id) })
    setBusy(false)
    if (r.error || !r.job) { setError(r.error ?? 'Could not save'); return }
    onDone(r.job)
    onClose()
  }
  return (
    <Modal title={`Check in items — ${job.ref}`} subtitle="Tick what the rider handed back. Anything unticked stays with the rider and the trip stays open." onClose={onClose} width={520}>
      <div className="space-y-1.5">
        {items.map(i => (
          <label key={i.id} className="flex items-start gap-2 text-xs p-2 rounded" style={{ background: 'var(--bg-surface)' }}>
            <input type="checkbox" checked={!!ticked[i.id]} onChange={e => setTicked(t => ({ ...t, [i.id]: e.target.checked }))} />
            <span>
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{i.qty > 1 ? `${i.qty} × ` : ''}{i.description}</span>
              {i.serial && <span style={{ color: 'var(--text-3)' }}> · {i.serial}</span>}
              <span className="block text-[10px]" style={{ color: 'var(--text-4)' }}>
                {i.direction === 'in' ? 'Collected at' : 'Not handed over at'} {i.stopAddress}
                {i.unplanned ? ` · customer gave it (${UNPLANNED_REASON_LABELS[i.unplanned.reason]})` : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-[10px] mt-2" style={{ color: 'var(--text-4)' }}>
        Checking in records that the items are back at the shop. Book returns or repairs in their own module as usual.
      </p>
      {error && <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" disabled={busy || !items.some(i => ticked[i.id])} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Items are back'}
        </button>
      </div>
    </Modal>
  )
}

/** Office: say what was done about something a customer handed the rider. */
export function FollowUpModal({ job, itemId, onDone, onClose }: { job: TripJob; itemId: string; onDone: (job: TripJob) => void; onClose: () => void }) {
  const item = openFollowUps(job).find(i => i.id === itemId)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!item) return null
  const submit = async () => {
    setBusy(true); setError('')
    const r = await tripAction(job.id, { action: 'follow_up', itemId, note })
    setBusy(false)
    if (r.error || !r.job) { setError(r.error ?? 'Could not save'); return }
    onDone(r.job)
    onClose()
  }
  return (
    <Modal title="Customer item — follow up" subtitle={`${job.ref} · ${String(job.customerName ?? '')}`} onClose={onClose} width={460}>
      <div className="text-xs space-y-1 p-2 rounded" style={{ background: 'var(--bg-surface)' }}>
        <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{item.qty > 1 ? `${item.qty} × ` : ''}{item.description}{item.serial ? ` · ${item.serial}` : ''}</p>
        <p style={{ color: 'var(--text-3)' }}>{UNPLANNED_REASON_LABELS[item.unplanned!.reason]} · from {item.stopAddress}</p>
        {item.unplanned?.billOnInvoice && <p className="font-semibold" style={{ color: 'var(--warning-text)' }}>Customer asked for it to go on their invoice</p>}
        {item.unplanned?.note && <p style={{ color: 'var(--text-3)' }}>“{item.unplanned.note}”</p>}
        <p style={{ color: 'var(--text-4)' }}>{item.receivedAt ? `Back at the shop (${item.receivedBy ?? ''})` : 'Still with the rider'}</p>
      </div>
      <label className="block mt-3">
        <span className="text-[11px] font-semibold text-t2 block mb-1">What was done</span>
        <textarea className="form-input text-xs w-full" rows={2} value={note} onChange={e => setNote(e.target.value)}
          placeholder='e.g. "Added to INV/2026/0123", "Credit note CN/2026/0012", "Booked in as REP/0456"' />
      </label>
      {error && <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" disabled={busy || note.trim().length < 3} onClick={() => void submit()}>{busy ? 'Saving…' : 'Mark handled'}</button>
      </div>
    </Modal>
  )
}

/** Stops, items and cash for the jobs table. */
export function TripSummary({ job, onCheckIn, onFollowUp }: { job: TripJob; onCheckIn: () => void; onFollowUp: (itemId: string) => void }) {
  if (!hasStops(job)) return null
  const p = stopProgress(job)
  const carried = carriedItems(job)
  const followUps = openFollowUps(job)
  const cash = tripCashTotal(job)
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[9px]" style={{ color: 'var(--text-3)' }}>
        {p.total} stop{p.total === 1 ? '' : 's'}: {jobStops(job).map(s => `${STOP_KIND_LABELS[s.kind]}${s.status === 'done' ? ' ✓' : s.status === 'failed' ? ' ✗' : ''}`).join(' → ')}
      </p>
      {cash > 0 && <p className="text-[9px] font-semibold" style={{ color: 'var(--warning-text)' }}>Rider collected KES {cash.toLocaleString('en-KE')}</p>}
      {carried.length > 0 && (
        <p className="text-[9px] font-semibold" style={{ color: 'var(--info, var(--navy))' }}>
          With rider: {carried.map(i => i.description).join(', ')}
          {stopsFinished(job) && (
            <button type="button" className="ml-1 underline" style={{ color: 'var(--navy)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={e => { e.stopPropagation(); onCheckIn() }}>
              {job.backAtShopAt ? 'Rider is back — check in' : 'Check in'}
            </button>
          )}
        </p>
      )}
      {followUps.map(i => (
        <p key={i.id} className="text-[9px] font-semibold" style={{ color: 'var(--warning-text)' }}>
          Customer gave: {i.description} ({UNPLANNED_REASON_LABELS[i.unplanned!.reason]}{i.unplanned?.billOnInvoice ? ', bill on invoice' : ''})
          <button type="button" className="ml-1 underline" style={{ color: 'var(--navy)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={e => { e.stopPropagation(); onFollowUp(i.id) }}>Follow up</button>
        </p>
      ))}
    </div>
  )
}
