'use client'

import React, { useMemo, useState } from 'react'
import type { SerialNumber } from '@/lib/store'
import UnitTestForm from '@/components/inventory/test-bench/UnitTestForm'
import { unitTestAction, useUnitTests, type UnitTestBrief } from '@/components/inventory/test-bench/useUnitTests'

type Unit = SerialNumber & { assetId?: string }
type Tech = { id: string; name: string }

const chip = 'text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap'

function minutesSince(iso?: string): string {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

const isToday = (iso?: string) => {
  if (!iso) return false
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

function UnitLine({ u, b, children, leading }: { u: Unit; b?: UnitTestBrief; children?: React.ReactNode; leading?: React.ReactNode }) {
  const last = b?.status === 'placed' ? { placedTo: b.placedTo, failReasons: b.failReasons } : b?.previous
  const retest = b?.source === 'retest_after_repair' || ['shop', 'repair_unit'].includes(String(last?.placedTo))
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold text-t1 truncate">{u.productName}</p>
        <p className="text-[11px] text-t3 flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="font-mono font-semibold text-t2">{u.assetId || u.serial}</span>
          {u.assetId && u.assetId !== u.serial ? <span className="font-mono">S/N {u.serial}</span> : null}
          {retest ? <span className={`${chip} bg-[var(--primary-light)] text-[var(--navy)]`}>Retest after repair</span> : null}
          {last?.failReasons.length ? <span>last failed: {last.failReasons.join(' · ')}</span> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>
    </div>
  )
}

function Card({ title, count, hint, children, empty }: { title: string; count: number; hint?: React.ReactNode; children: React.ReactNode; empty: string }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-lt)] bg-[var(--bg-surface)]">
        <p className="text-[13px] font-bold text-t1">{title} <span className="ml-1 text-[11px] font-bold tabular-nums text-t3">{count}</span></p>
        {hint}
      </div>
      {count === 0 ? <p className="py-6 text-center text-[12px] text-t3">{empty}</p> : <div className="divide-y divide-[var(--border-lt)]">{children}</div>}
    </section>
  )
}

/**
 * Refurbishment › Test bench. The Technical lead gives units waiting in
 * Inbound to testers; each tester sees and tests only what was given to
 * them. Finished tests go to Inventory to be placed.
 */
export default function TestBenchTab({ serials, techs, currentUserId, canAssign, canRecord, canOverride, notify }: {
  serials: SerialNumber[]
  techs: Tech[]
  currentUserId: string | null
  canAssign: boolean
  canRecord: boolean
  canOverride: boolean
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const { bySerial, briefs, refresh, loaded } = useUnitTests(true)
  const [open, setOpen] = useState<Unit | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const allInbound = useMemo(() => (serials as Unit[]).filter(s => s.location === 'pending_testing' && s.status !== 'sold'), [serials])
  // Search: asset ID, serial, barcode, model or tester; every word must match.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (u: Unit) => {
    if (!words.length) return true
    const hay = [u.assetId, u.serial, u.barcode, u.productName, bySerial.get(u.id)?.assignedToName].map(v => String(v ?? '').toLowerCase()).join(' ')
    return words.every(w => hay.includes(w))
  }
  const inbound = allInbound.filter(matches)
  const retestFirst = (a: Unit, b: Unit) => {
    const r = (u: Unit) => {
      const x = bySerial.get(u.id)
      const last = x?.status === 'placed' ? x.placedTo : x?.previous?.placedTo
      return x?.source === 'retest_after_repair' || ['shop', 'repair_unit', 'quarantine'].includes(String(last)) ? 0 : 1
    }
    return r(a) - r(b)
  }
  const stage = (u: Unit) => bySerial.get(u.id)?.status
  const unassigned = inbound.filter(u => !['assigned', 'in_progress', 'completed'].includes(String(stage(u)))).sort(retestFirst)
  const withTester = inbound.filter(u => ['assigned', 'in_progress'].includes(String(stage(u))))
  const awaitingPlacement = inbound.filter(u => stage(u) === 'completed').length
  const ownerOf = (u: Unit) => bySerial.get(u.id)?.assignedToId ?? ''
  const doneToday = briefs.filter(b => (b.status === 'completed' || b.status === 'placed') && isToday(b.completedAt))

  const techName = (id: string) => techs.find(t => t.id === id)?.name ?? bySerial.get(withTester.find(u => ownerOf(u) === id)?.id ?? '')?.assignedToName ?? 'Tester'

  async function assign(ids: string[], techId: string) {
    if (!ids.length || !techId) return
    setBusy(true)
    const r = await unitTestAction<{ assigned: number; skipped: string[] }>({ action: 'assign', serialIds: ids, techId })
    setBusy(false)
    if (!r.ok) { notify(r.error, 'error'); return }
    const name = techs.find(t => t.id === techId)?.name ?? 'the tester'
    notify(`${r.data.assigned} unit${r.data.assigned === 1 ? '' : 's'} assigned to ${name}${r.data.skipped.length ? ` — skipped ${r.data.skipped.join(', ')}` : ''}`)
    setPicked(new Set())
    void refresh()
    // Tell the tester (best effort).
    if (techId !== currentUserId) {
      fetch('/api/notifications/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [techId],
          type: 'assignment',
          title: 'Units to test',
          body: `${r.data.assigned} unit${r.data.assigned === 1 ? '' : 's'} assigned to you on the test bench.`,
          module: 'refurbishment',
          path: '?view=bench',
          entityKey: `unittest:${techId}:assigned_${Date.now()}`,
        }),
      }).catch(() => {})
    }
  }

  async function unassign(id: string) {
    const r = await unitTestAction<{ ok: true }>({ action: 'unassign', serialIds: [id] })
    if (!r.ok) { notify(r.error, 'error'); return }
    notify('Back to unassigned')
    void refresh()
  }

  const startBtn = (u: Unit) => {
    const s = stage(u)
    return (
      <button type="button" className={s === 'in_progress' ? 'btn-secondary text-[11px]' : 'btn-primary text-[11px]'} onClick={() => setOpen(u)}>
        {s === 'in_progress' ? 'Continue test' : 'Start test'}
      </button>
    )
  }

  const statusChip = (u: Unit) => {
    const b = bySerial.get(u.id)
    return b?.status === 'in_progress'
      ? <span className={`${chip} bg-[var(--info-bg)] text-[var(--info-text)]`}>On the bench {minutesSince(b.startedAt)}</span>
      : <span className={`${chip} bg-[var(--bg-muted)] text-t3`}>Waiting · given {minutesSince(b?.assignedAt)} ago</span>
  }

  const form = open && (
    <UnitTestForm
      unit={open}
      onClose={() => { setOpen(null); void refresh() }}
      onChanged={() => { void refresh() }}
      canRecord={canRecord}
      canOverride={canOverride}
      notify={notify}
    />
  )

  const placementNote = awaitingPlacement > 0 ? (
    <a href="/inventory?tab=warehouse&location=tested" className="text-[11px] font-semibold text-[var(--navy)] hover:underline">
      {awaitingPlacement} tested, waiting for Inventory to place →
    </a>
  ) : null

  const searchBox = (onEnter: () => void, shownCount: number) => (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <input
        type="search"
        className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 text-[13px] text-t1 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
        placeholder="Search or scan: asset ID, serial, model or tester…"
        aria-label="Search units on the test bench"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } if (e.key === 'Escape') setQuery('') }}
      />
      {words.length ? (
        <p className="text-[11px] text-t3 shrink-0">
          {shownCount} match{shownCount === 1 ? '' : 'es'} · <button type="button" className="font-semibold text-[var(--navy)] hover:underline" onClick={() => setQuery('')}>Clear</button>
        </p>
      ) : null}
    </div>
  )

  if (!loaded) return <p className="text-[12px] text-t3 px-1">Loading the test bench…</p>

  // ── Tester: only what was given to them ──────────────────────────────
  if (!canAssign) {
    const mine = withTester.filter(u => ownerOf(u) === currentUserId)
    const waiting = mine.filter(u => stage(u) === 'assigned').sort(retestFirst)
    const onBench = mine.filter(u => stage(u) === 'in_progress')
    const myDone = doneToday.filter(b => b.testedById === currentUserId)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-t2">
          <span className="font-semibold">Today: {myDone.length} tested</span>
          {myDone.length ? <span className="text-t3">({myDone.filter(b => b.result !== 'failed').length} passed · {myDone.filter(b => b.result === 'failed').length} failed)</span> : null}
        </div>
        {/* Scanning a unit's sticker opens its test when it is one of mine. */}
        {searchBox(() => { const only = [...onBench, ...waiting]; if (only.length === 1) setOpen(only[0]) }, onBench.length + waiting.length)}
        <Card title="On my bench" count={onBench.length} empty="Nothing started">
          {onBench.map(u => <UnitLine key={u.id} u={u} b={bySerial.get(u.id)}>{statusChip(u)}{startBtn(u)}</UnitLine>)}
        </Card>
        <Card title="My units to test" count={waiting.length} empty="Nothing assigned to you. The Technical lead gives out units to test.">
          {waiting.map(u => <UnitLine key={u.id} u={u} b={bySerial.get(u.id)}>{startBtn(u)}</UnitLine>)}
        </Card>
        {form}
      </div>
    )
  }

  // ── Technical lead: assign and follow every tester ───────────────────
  // Searching shows only the testers with matching units.
  const owners = Array.from(new Set([...withTester.map(ownerOf), ...(words.length ? [] : doneToday.map(b => b.testedById ?? ''))].filter(Boolean)))
  const allPicked = unassigned.length > 0 && unassigned.every(u => picked.has(u.id))
  const totals = {
    toAssign: allInbound.filter(u => !['assigned', 'in_progress', 'completed'].includes(String(stage(u)))).length,
    withTesters: allInbound.filter(u => stage(u) === 'assigned').length,
    onBench: allInbound.filter(u => stage(u) === 'in_progress').length,
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ['To assign', totals.toAssign],
          ['With testers', totals.withTesters],
          ['On the bench', totals.onBench],
          ['Tested today', doneToday.length],
        ].map(([l, n]) => (
          <div key={String(l)} className="card px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-t3">{l}</p>
            <p className="text-lg font-extrabold tabular-nums text-[var(--navy)] leading-tight">{n}</p>
          </div>
        ))}
      </div>

      {/* Scanning a sticker ticks that unit for assigning (one exact match). */}
      {searchBox(() => {
        if (unassigned.length !== 1) return
        const u = unassigned[0]
        setPicked(prev => new Set(prev).add(u.id))
        setQuery('')
        notify(`${u.assetId || u.serial} ticked — ${picked.has(u.id) ? picked.size : picked.size + 1} selected`, 'info')
      }, unassigned.length + withTester.length)}

      <Card
        title="Waiting to be assigned"
        count={unassigned.length}
        empty={words.length ? 'No unassigned unit matches this search' : 'Nothing waiting — every unit in Inbound has a tester.'}
        hint={unassigned.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-t2 cursor-pointer select-none">
              <input type="checkbox" checked={allPicked} onChange={e => setPicked(e.target.checked ? new Set(unassigned.map(u => u.id)) : new Set())} />
              Select all
            </label>
            <select className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-[12px] text-t1" value={assignTo} onChange={e => setAssignTo(e.target.value)} aria-label="Tester">
              <option value="">Choose tester…</option>
              {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="btn-primary text-[11px]" disabled={busy || !assignTo || picked.size === 0}
              onClick={() => void assign([...picked], assignTo)}>
              Assign {picked.size || ''}
            </button>
          </div>
        ) : null}
      >
        {unassigned.map(u => (
          <UnitLine key={u.id} u={u} b={bySerial.get(u.id)}
            leading={<input type="checkbox" aria-label={`Select ${u.serial}`} checked={picked.has(u.id)}
              onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n })} />}>
            {canRecord ? <button type="button" className="btn-outline text-[11px]" onClick={() => setOpen(u)}>Test it myself</button> : null}
          </UnitLine>
        ))}
      </Card>

      {owners.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-[var(--navy)]">By tester</p>
            {placementNote}
          </div>
          {owners.map(id => {
            const units = withTester.filter(u => ownerOf(u) === id).sort((a, b) => (stage(a) === 'in_progress' ? -1 : 0) - (stage(b) === 'in_progress' ? -1 : 0))
            const done = doneToday.filter(b => b.testedById === id)
            return (
              <Card key={id} title={techName(id)} count={units.length}
                hint={<span className="text-[11px] text-t3">{units.filter(u => stage(u) === 'assigned').length} waiting · {units.filter(u => stage(u) === 'in_progress').length} on the bench · {done.length} tested today ({done.filter(b => b.result === 'failed').length} failed)</span>}
                empty="Nothing waiting with this tester">
                {units.map(u => (
                  <UnitLine key={u.id} u={u} b={bySerial.get(u.id)}>
                    {statusChip(u)}
                    <select className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-[11px] text-t2" value="" aria-label={`Reassign ${u.serial}`}
                      onChange={e => { if (e.target.value) void assign([u.id], e.target.value) }}>
                      <option value="">Reassign…</option>
                      {techs.filter(t => t.id !== id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {stage(u) === 'assigned' ? <button type="button" className="text-[11px] font-semibold text-t3 hover:text-[var(--danger-text)]" onClick={() => void unassign(u.id)}>Unassign</button> : null}
                    <button type="button" className="btn-outline text-[11px]" onClick={() => setOpen(u)}>{stage(u) === 'in_progress' ? 'Open' : 'Test it myself'}</button>
                  </UnitLine>
                ))}
              </Card>
            )
          })}
        </div>
      )}
      {owners.length === 0 && placementNote ? <div>{placementNote}</div> : null}
      {form}
    </div>
  )
}
