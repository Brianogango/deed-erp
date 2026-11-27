'use client'

import { useMemo, useState } from 'react'
import type { RefurbishmentJob } from '@/lib/store'
import type { UnitTestBrief } from '@/components/inventory/test-bench/useUnitTests'

type Serial = { id: string; serial: string; productName?: string; productId?: string; location?: string }

type Card = {
  key: string
  title: string
  serial: string
  who?: string
  since?: string
  note?: string
  onOpen: () => void
}

const days = (iso?: string) => {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null
}
const ago = (iso?: string) => {
  const d = days(iso)
  return d === null ? '' : d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

/**
 * The workshop at a glance: every machine being tested or repaired, in the
 * step it is at, oldest first, with who has it and how long it has waited.
 * Tests are worked on the Test bench tab; repairs open their job.
 */
export default function WorkshopBoard({ jobs, tests, serials, products = [], onOpenJob, onOpenBench, mineOnly, currentUserId }: {
  jobs: RefurbishmentJob[]
  products?: Array<{ id: string; name: string }>
  tests: UnitTestBrief[]
  serials: Serial[]
  onOpenJob: (id: string) => void
  onOpenBench: () => void
  mineOnly?: boolean
  currentUserId?: string | null
}) {
  const [step, setStep] = useState(0)
  const serialById = useMemo(() => new Map(serials.map(s => [s.id, s])), [serials])
  const productName = useMemo(() => new Map(products.map(p => [p.id, p.name])), [products])

  const columns = useMemo(() => {
    const live = tests.filter(t => t.status === 'assigned' || t.status === 'in_progress')
    const testCard = (t: UnitTestBrief): Card => {
      const s = serialById.get(t.serialId)
      return {
        key: `t-${t.testId}`,
        title: s?.productName || (s?.productId ? productName.get(s.productId) : undefined) || 'Machine',
        serial: s?.serial || t.serialId,
        who: t.status === 'in_progress' ? (t.testedByName || t.startedByName || t.assignedToName) : t.assignedToName,
        since: t.status === 'in_progress' ? t.startedAt : (t.assignedAt || t.startedAt),
        note: t.source === 'refurb_final' || t.refurbJobRef ? `Final test · ${t.refurbJobRef ?? ''}`.trim() : t.previous ? `Retest · last ${t.previous.result}` : undefined,
        onOpen: onOpenBench,
      }
    }
    const jobCard = (j: RefurbishmentJob, since?: string): Card => ({
      key: `j-${j.id}`,
      title: j.productName,
      serial: j.serialNumber,
      who: j.assignedTechnicianName,
      since,
      note: j.ref,
      onOpen: () => onOpenJob(j.id),
    })
    const mine = (techId?: string | null) => !mineOnly || !currentUserId || techId === currentUserId
    const open = jobs.filter(j => !['transferred', 'written_off'].includes(j.status))
    const sortOld = (a: Card, b: Card) => String(a.since ?? '').localeCompare(String(b.since ?? ''))
    return [
      { id: 'to_test', label: 'To test', hint: 'Sent to the bench — not started', cards: live.filter(t => t.status === 'assigned' && mine(t.assignedToId)).map(testCard).sort(sortOld) },
      { id: 'testing', label: 'Testing', hint: 'On the bench now', cards: live.filter(t => t.status === 'in_progress' && mine(t.testedById ?? t.assignedToId)).map(testCard).sort(sortOld) },
      { id: 'to_repair', label: 'To repair', hint: 'Job waiting to start', cards: open.filter(j => (j.status === 'queued' || j.status === 'assigned') && mine(j.assignedTechnicianId)).map(j => jobCard(j, j.assignedDate || j.intakeDate)).sort(sortOld) },
      { id: 'repairing', label: 'Repairing', hint: 'Being worked on', cards: open.filter(j => j.status === 'in_progress' && mine(j.assignedTechnicianId)).map(j => jobCard(j, j.startedDate || j.assignedDate || j.intakeDate)).sort(sortOld) },
      { id: 'final', label: 'Final test', hint: 'Repaired — needs its test', cards: open.filter(j => j.status === 'ready' && mine(j.assignedTechnicianId)).map(j => jobCard(j, j.completedDate || j.startedDate || j.intakeDate)).sort(sortOld) },
    ]
  }, [jobs, tests, serialById, productName, onOpenJob, onOpenBench, mineOnly, currentUserId])

  const renderCard = (c: Card) => {
    const d = days(c.since)
    return (
      <li key={c.key}>
        <button type="button" className={`workshop-card${d !== null && d >= 7 ? ' is-late' : d !== null && d >= 3 ? ' is-slow' : ''}`} onClick={c.onOpen}>
          <strong>{c.title}</strong>
          <span className="workshop-card__serial">{c.serial}</span>
          <span className="workshop-card__meta">
            {c.who ? c.who : <em>Unassigned</em>}
            {c.since ? ` · ${ago(c.since)}` : ''}
          </span>
          {c.note && <span className="workshop-card__note">{c.note}</span>}
        </button>
      </li>
    )
  }

  const total = columns.reduce((s, c) => s + c.cards.length, 0)

  return (
    <div className="workshop-board">
      <div className="workshop-board__steps" role="tablist" aria-label="Workshop steps">
        {columns.map((col, i) => (
          <button key={col.id} type="button" role="tab" aria-selected={step === i} className={step === i ? 'is-active' : ''} onClick={() => setStep(i)}>
            {col.label} <b>{col.cards.length}</b>
          </button>
        ))}
      </div>
      {total === 0 && <p className="workshop-board__empty">Nothing in the workshop{mineOnly ? ' for you' : ''} right now.</p>}
      <div className="workshop-board__cols">
        {columns.map((col, i) => (
          <section key={col.id} className={`workshop-col${step === i ? ' is-current' : ''}`} aria-label={col.label}>
            <header>
              <h3>{col.label} <span>{col.cards.length}</span></h3>
              <p>{col.hint}</p>
            </header>
            {col.cards.length ? <ul>{col.cards.map(renderCard)}</ul> : <p className="workshop-col__empty">None</p>}
          </section>
        ))}
      </div>
      <p className="workshop-board__legend"><i className="is-slow" /> waiting 3+ days <i className="is-late" /> 7+ days</p>
    </div>
  )
}
