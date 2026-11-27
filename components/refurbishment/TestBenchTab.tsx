'use client'

import React, { useMemo, useState } from 'react'
import type { SerialNumber } from '@/lib/store'
import UnitTestForm from '@/components/inventory/test-bench/UnitTestForm'
import { unitTestAction, useUnitTests, type UnitTestBrief } from '@/components/inventory/test-bench/useUnitTests'

type Unit = SerialNumber & { assetId?: string }
type Tech = { id: string; name: string }

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

function UnitLine({ u, b, children, leading, accent }: { u: Unit; b?: UnitTestBrief; children?: React.ReactNode; leading?: React.ReactNode; accent?: boolean }) {
  const last = b?.status === 'placed' ? { placedTo: b.placedTo, failReasons: b.failReasons } : b?.previous
  const retestAfterRepair = b?.source === 'retest_after_repair' || ['shop', 'repair_unit'].includes(String(last?.placedTo))
  const tag = retestAfterRepair ? <span className="tb-tag tb-tag--vio">Retest after repair</span>
    : last ? <span className="tb-tag">Retest</span>
    : <span className="tb-tag tb-tag--new">New</span>
  return (
    <div className={`tb-unit${accent ? ' is-picked' : ''}`}>
      {leading}
      <div className="tb-unit__main">
        <p className="tb-unit__name"><span>{u.productName}</span>{tag}</p>
        <p className="tb-unit__meta">
          <span className="tb-mono">{u.assetId || u.serial}</span>
          {u.assetId && u.assetId !== u.serial ? <span className="tb-mono">S/N {u.serial}</span> : null}
          {last?.failReasons.length ? <span className="tb-unit__fail">last failed: {last.failReasons.join(' · ')}</span> : null}
        </p>
      </div>
      <div className="tb-unit__actions">{children}</div>
    </div>
  )
}

function Card({ title, count, hint, children, empty }: { title: string; count: number; hint?: React.ReactNode; children: React.ReactNode; empty: string }) {
  return (
    <section className="tb-card">
      <div className="tb-card__head">
        <h3>{title} <span className="tb-count">{count}</span></h3>
        {hint}
      </div>
      {count === 0 ? <p className="tb-card__empty">{empty}</p> : <div>{children}</div>}
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
      ? <span className="tb-pill tb-pill--info">On the bench · {minutesSince(b.startedAt)}</span>
      : <span className="tb-pill">Waiting · given {minutesSince(b?.assignedAt)} ago</span>
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
    <a href="/inventory?tab=warehouse&location=tested" className="tb-link">
      {awaitingPlacement} tested, waiting for Inventory to place →
    </a>
  ) : null

  const searchBox = (onEnter: () => void, shownCount: number, hint: string) => (
    <div className="tb-scan">
      <span className="tb-scan__icon" aria-hidden="true">▣</span>
      <input
        type="search"
        placeholder={hint}
        aria-label="Search units on the test bench"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } if (e.key === 'Escape') setQuery('') }}
      />
      {words.length ? (
        <span className="tb-scan__count">
          {shownCount} match{shownCount === 1 ? '' : 'es'} · <button type="button" onClick={() => setQuery('')}>Clear</button>
        </span>
      ) : null}
    </div>
  )

  if (!loaded) return <p className="tb-loading">Loading the test bench…</p>

  // ── Tester: only what was given to them ──────────────────────────────
  if (!canAssign) {
    const mine = withTester.filter(u => ownerOf(u) === currentUserId)
    const waiting = mine.filter(u => stage(u) === 'assigned').sort(retestFirst)
    const onBench = mine.filter(u => stage(u) === 'in_progress')
    const myDone = doneToday.filter(b => b.testedById === currentUserId)
    const myPassed = myDone.filter(b => b.result !== 'failed').length
    return (
      <div className="tb">
        <div className="tb-today">
          <div><span>Today</span><strong>{myDone.length} tested</strong></div>
          {myDone.length ? <div className="tb-today__split"><span className="tb-pill tb-pill--ok">{myPassed} passed</span><span className="tb-pill tb-pill--bad">{myDone.length - myPassed} failed</span></div> : null}
        </div>
        {/* Scanning a unit's sticker opens its test when it is one of mine. */}
        {searchBox(() => { const only = [...onBench, ...waiting]; if (only.length === 1) setOpen(only[0]) }, onBench.length + waiting.length, 'Scan a sticker or type a serial to open its test')}
        <Card title="On my bench" count={onBench.length} empty="Nothing started">
          {onBench.map(u => <UnitLine key={u.id} u={u} b={bySerial.get(u.id)} accent>{statusChip(u)}{startBtn(u)}</UnitLine>)}
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
  const passedToday = doneToday.filter(b => b.result !== 'failed').length
  return (
    <div className="tb">
      <div className="tb-tiles">
        <div className="tb-tile"><span>To assign</span><strong>{totals.toAssign}</strong><small>waiting for a tester</small></div>
        <div className="tb-tile"><span>With testers</span><strong>{totals.withTesters}</strong><small>not started yet</small></div>
        <div className="tb-tile"><span>On the bench</span><strong>{totals.onBench}</strong><small>being tested now</small></div>
        <div className="tb-tile"><span>Tested today</span><strong>{doneToday.length}</strong><small><b className="is-ok">{passedToday} passed</b> · <b className="is-bad">{doneToday.length - passedToday} failed</b></small></div>
      </div>

      {/* Scanning a sticker ticks that unit for assigning (one exact match). */}
      {searchBox(() => {
        if (unassigned.length !== 1) return
        const u = unassigned[0]
        setPicked(prev => new Set(prev).add(u.id))
        setQuery('')
        notify(`${u.assetId || u.serial} ticked — ${picked.has(u.id) ? picked.size : picked.size + 1} selected`, 'info')
      }, unassigned.length + withTester.length, 'Scan a sticker or type a serial, model or tester — a match is ticked for assigning')}

      <div className="tb-cols">
        <Card
          title="Waiting to be assigned"
          count={unassigned.length}
          empty={words.length ? 'No unassigned unit matches this search' : 'Nothing waiting — every unit in Inbound has a tester.'}
          hint={unassigned.length ? (
            <div className="tb-assign">
              <label className="tb-assign__all">
                <input type="checkbox" checked={allPicked} onChange={e => setPicked(e.target.checked ? new Set(unassigned.map(u => u.id)) : new Set())} />
                All
              </label>
              <select value={assignTo} onChange={e => setAssignTo(e.target.value)} aria-label="Tester">
                <option value="">Choose tester…</option>
                {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="btn-primary" disabled={busy || !assignTo || picked.size === 0}
                onClick={() => void assign([...picked], assignTo)}>
                Assign{picked.size ? ` ${picked.size}` : ''}
              </button>
            </div>
          ) : null}
        >
          {unassigned.map(u => (
            <UnitLine key={u.id} u={u} b={bySerial.get(u.id)} accent={picked.has(u.id)}
              leading={<input type="checkbox" className="tb-check" aria-label={`Select ${u.serial}`} checked={picked.has(u.id)}
                onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n })} />}>
              {canRecord ? <button type="button" className="btn-outline" onClick={() => setOpen(u)}>Test it myself</button> : null}
            </UnitLine>
          ))}
        </Card>

        <section className="tb-card">
          <div className="tb-card__head">
            <h3>By tester</h3>
            {placementNote ?? <span className="tb-muted">today</span>}
          </div>
          {owners.length === 0 ? <p className="tb-card__empty">No tester has units right now.</p> : owners.map(id => {
            const units = withTester.filter(u => ownerOf(u) === id).sort((a, b) => (stage(a) === 'in_progress' ? -1 : 0) - (stage(b) === 'in_progress' ? -1 : 0))
            const done = doneToday.filter(b => b.testedById === id)
            const failed = done.filter(b => b.result === 'failed').length
            const bench = units.filter(u => stage(u) === 'in_progress').length
            const waitingN = units.filter(u => stage(u) === 'assigned').length
            const total = Math.max(1, done.length + bench + waitingN)
            const name = techName(id)
            return (
              <div key={id} className="tb-tester">
                <div className="tb-tester__head">
                  <span className="tb-tester__who"><span className="tb-avatar">{name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span><strong>{name}</strong></span>
                  <span className="tb-muted">{done.length} tested · {bench} on bench · {waitingN} waiting</span>
                </div>
                <div className="tb-bar" aria-hidden="true">
                  <i className="is-ok" style={{ width: `${((done.length - failed) / total) * 100}%` }} />
                  <i className="is-bad" style={{ width: `${(failed / total) * 100}%` }} />
                  <i className="is-info" style={{ width: `${(bench / total) * 100}%` }} />
                </div>
                {units.map(u => {
                  const b = bySerial.get(u.id)
                  return (
                    <div key={u.id} className="tb-mini">
                      <span className="tb-mini__what">
                        <b>{stage(u) === 'in_progress' ? 'On bench' : 'Waiting'}</b> · {u.productName} · <span className="tb-mono">{u.assetId || u.serial}</span>
                        <em className={stage(u) === 'in_progress' ? 'is-info' : ''}>{stage(u) === 'in_progress' ? minutesSince(b?.startedAt) : `given ${minutesSince(b?.assignedAt)} ago`}</em>
                      </span>
                      <span className="tb-mini__act">
                        <select value="" aria-label={`Reassign ${u.serial}`} onChange={e => { if (e.target.value) void assign([u.id], e.target.value) }}>
                          <option value="">Reassign…</option>
                          {techs.filter(t => t.id !== id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        {stage(u) === 'assigned' ? <button type="button" className="tb-textbtn" onClick={() => void unassign(u.id)}>Unassign</button> : null}
                        <button type="button" className="tb-textbtn is-strong" onClick={() => setOpen(u)}>{stage(u) === 'in_progress' ? 'Open' : 'Test it myself'}</button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {owners.length ? (
            <div className="tb-legend"><span><i className="is-ok" />passed</span><span><i className="is-bad" />failed</span><span><i className="is-info" />on bench</span><span><i />waiting</span></div>
          ) : null}
        </section>
      </div>
      {form}
    </div>
  )
}
