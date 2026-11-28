'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate, uid } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Modal, PanelHeader, Select, Textarea } from '@/components/ui'
import { RATING_LABEL, STATUS_LABEL, canAcknowledge, canManagerAssess, canSelfAssess, weightedScore, type AppraisalStatus, type Goal } from '@/lib/hr/appraisals'

interface Cycle { id: string; name: string; periodStart: string; periodEnd: string; status: string }
interface Appraisal {
  id: string; cycleId: string; employeeId: string; employeeName: string; employeeNo: string; jobTitle: string
  managerEmployeeId: string | null; reviewerName: string; status: AppraisalStatus; goals: Goal[]
  selfComments: string; managerComments: string; strengths: string; improvements: string
  selfRating: number | null; managerRating: number | null; finalRating: number | null; employeeAckAt: string | null
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body?.error || 'The request failed'), { body })
  return body as T
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const ratingOptions = [{ value: '', label: 'Select…' }, ...[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} · ${RATING_LABEL[n]}` }))]

/**
 * Performance reviews. `manage` (HR) opens cycles and sees everyone; otherwise it shows the
 * signed-in person's own review and the reviews of people who report to them.
 */
export default function AppraisalsPanel({ manage }: { manage: boolean }) {
  const { showToast, currentUser } = useApp()
  const { employees } = useHrStore()
  const me = employees.find(e => e.userId === currentUser?.id) ?? null
  const [data, setData] = useState<{ cycles: Cycle[]; appraisals: Appraisal[] } | null>(null)
  const [cycleFilter, setCycleFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [newCycle, setNewCycle] = useState(false)
  const [cycleForm, setCycleForm] = useState({ name: '', periodStart: '', periodEnd: '' })

  const load = useCallback(async () => {
    try { setData(await api('/api/appraisals')) }
    catch (e) { setData({ cycles: [], appraisals: [] }); showToast(e instanceof Error ? e.message : 'Could not load reviews', 'error') }
  }, [showToast])
  useEffect(() => { void load() }, [load])

  const who = { employeeId: me?.id ?? null, isHr: manage }
  const cycles = data?.cycles ?? []
  const activeCycle = cycleFilter || cycles.find(c => c.status === 'open')?.id || cycles[0]?.id || ''
  const rows = useMemo(() => (data?.appraisals ?? []).filter(a => !activeCycle || a.cycleId === activeCycle), [data, activeCycle])
  const current = data?.appraisals.find(a => a.id === open) ?? null
  const cycle = cycles.find(c => c.id === activeCycle)
  const completed = rows.filter(a => a.status === 'completed').length

  const createCycle = async () => {
    if (!cycleForm.name.trim() || !cycleForm.periodStart || !cycleForm.periodEnd) { showToast('Enter a name and the period covered', 'error'); return }
    try {
      const out = await api<{ cycle: Cycle; created: number }>('/api/appraisals', post(cycleForm))
      showToast(`Cycle opened with ${out.created} reviews`, 'success')
      setNewCycle(false); setCycleForm({ name: '', periodStart: '', periodEnd: '' }); setCycleFilter(out.cycle.id)
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not open the cycle', 'error') }
  }
  const closeCycle = async (force = false) => {
    if (!cycle) return
    try { await api(`/api/appraisals/cycles/${cycle.id}`, patch({ status: 'closed', force })); await load() }
    catch (e) {
      const err = e as Error & { body?: { openCount?: number } }
      if (err.body?.openCount && !force && window.confirm(`${err.message}\n\nClose it anyway?`)) return closeCycle(true)
      if (!err.body?.openCount) showToast(err.message, 'error')
    }
  }

  const modals = (
    <>
      {newCycle && (
        <Modal title="Open review cycle" subtitle="A review is created for every active employee" onClose={() => setNewCycle(false)} width={460}>
          <div className="flex flex-col gap-3">
            <Field label="Name" required><Input value={cycleForm.name} onChange={v => setCycleForm(f => ({ ...f, name: v }))} placeholder="e.g. Mid-year 2026" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period starts" required><Input type="date" value={cycleForm.periodStart} onChange={v => setCycleForm(f => ({ ...f, periodStart: v }))} /></Field>
              <Field label="Period ends" required><Input type="date" value={cycleForm.periodEnd} onChange={v => setCycleForm(f => ({ ...f, periodEnd: v }))} /></Field>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Each employee writes a self-assessment, then their manager (the person set under "Reports to") reviews it. Employees without a manager are reviewed by HR.</p>
          </div>
          <div className="hr-modal-actions flex justify-end gap-2 pt-3">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setNewCycle(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={createCycle}>Open cycle</button>
          </div>
        </Modal>
      )}

      {current && <AppraisalModal appraisal={current} cycleOpen={cycle?.status === 'open'} who={who} reviewerName={currentUser?.name ?? ''} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await load() }} />}
    </>
  )

  if (!manage && (data?.appraisals.length ?? 0) === 0) return null

  const remind = async (a: Appraisal) => {
    try {
      const out = await api<{ reminded: string }>(`/api/appraisals/${a.id}/remind`, post({}))
      showToast(`Reminder sent to ${out.reminded}`, 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not send the reminder', 'error') }
  }
  const selfDone = rows.filter(a => a.status !== 'pending_self').length
  const mgrDone = completed
  const closed = cycle?.status === 'closed'
  const step = (done: boolean, now: boolean) => (done ? 'd' : now ? 'n' : '')

  // HR mock F: the cycle as its four steps, then where each person is.
  if (manage) return (
    <section className="hra-card hrf">
      <div className="hra-ch">
        <b className="hrc-title">{cycle ? `${cycle.name} · ${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : 'Performance reviews'}</b>
        <div className="hrf-tools">
          {cycles.length > 1 && (
            <select className="hre-select" value={activeCycle} onChange={e => setCycleFilter(e.target.value)} aria-label="Review cycle">
              {cycles.map(c => <option key={c.id} value={c.id}>{c.name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}
            </select>
          )}
          {cycle && !closed && <button type="button" className="hrb-btn is-p" onClick={() => closeCycle()}>Close cycle</button>}
          {(!cycle || closed) && <button type="button" className="hrb-btn is-p" onClick={() => setNewCycle(true)}>+ Open review cycle</button>}
        </div>
      </div>
      {data === null && <p className="hrb-empty">Loading…</p>}
      {data && !cycle && <p className="hrb-empty">No review cycle yet. Open one to create a review for every active employee.</p>}
      {cycle && (
        <>
          <div className="hrf-cyc">
            <div className={step(true, false)}><b>Opened</b>{fmtDate(cycle.periodStart)}</div>
            <div className={step(selfDone === rows.length && rows.length > 0, selfDone < rows.length)}><b>Self review</b>{selfDone} of {rows.length} done</div>
            <div className={step(mgrDone === rows.length && rows.length > 0, selfDone > 0 && mgrDone < rows.length)}><b>Manager review</b>{mgrDone} of {rows.length} · due {fmtDate(cycle.periodEnd)}</div>
            <div className={step(closed, !closed && mgrDone === rows.length && rows.length > 0)}><b>Close & share</b>{closed ? 'Closed' : '—'}</div>
          </div>
          <div className="hra-table-wrap">
            <table className="hra-table">
              <thead><tr><th>Person</th><th>Self</th><th>Manager</th><th>Score</th><th /></tr></thead>
              <tbody>
                {rows.map(a => {
                  const self = a.status === 'pending_self' ? <span className="hra-chip is-r">Not started</span> : <span className="hra-chip is-g">Done</span>
                  const mgr = a.status === 'completed' ? <span className="hra-chip is-g">Done</span>
                    : a.status === 'pending_manager' ? <span className="hra-chip is-a">Waiting{a.reviewerName ? ` · ${a.reviewerName}` : ''}</span>
                    : <span className="hra-chip is-s">—</span>
                  const btn = canManagerAssess(a, who) && !closed ? <button type="button" className="hrb-btn" onClick={() => setOpen(a.id)}>Review</button>
                    : a.status !== 'completed' && !closed ? <button type="button" className="hrb-btn" onClick={() => void remind(a)}>Remind</button>
                    : <button type="button" className="hrb-btn" onClick={() => setOpen(a.id)}>Open</button>
                  return (
                    <tr key={a.id} className="is-static">
                      <td>{a.employeeName}</td>
                      <td>{self}</td>
                      <td>{mgr}</td>
                      <td>{a.finalRating ? <b>{Number(a.finalRating).toFixed(1)}</b> : '—'}</td>
                      <td className="hra-r">{btn}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {modals}
    </section>
  )

  return (
    <div className="hr-submodule-panel card overflow-hidden">
      <PanelHeader title="My reviews" count={rows.length} />
      <div className="p-3 text-xs">
        {rows.map(a => {
          const action = canSelfAssess(a, who) ? 'Write self-assessment' : canManagerAssess(a, who) ? 'Review' : canAcknowledge({ ...a, status: a.status }, who) ? 'View and acknowledge' : 'View'
          return (
            <div key={a.id} className="flex items-center justify-between gap-3 py-2 flex-wrap" style={{ borderTop: '1px solid var(--border-lt)' }}>
              <div>
                <span className="font-semibold">{a.employeeName}</span> <span style={{ color: 'var(--text-4)' }}>{a.employeeNo}{a.jobTitle ? ` · ${a.jobTitle}` : ''}</span>
                <div style={{ color: a.status === 'completed' ? 'var(--success-text)' : 'var(--text-3)' }}>
                  {STATUS_LABEL[a.status]}{a.finalRating ? ` · ${a.finalRating}/5 ${RATING_LABEL[a.finalRating] ?? ''}` : ''}{a.status === 'completed' && !a.employeeAckAt ? ' · not yet acknowledged' : ''}
                </div>
              </div>
              <button className={action === 'View' ? 'btn-outline text-[11px]' : 'btn-primary text-[11px]'} onClick={() => setOpen(a.id)}>{action}</button>
            </div>
          )
        })}
      </div>
      {modals}
    </div>
  )
}

function AppraisalModal({ appraisal: a, cycleOpen, who, reviewerName, onClose, onDone }: {
  appraisal: Appraisal; cycleOpen: boolean; who: { employeeId: string | null; isHr: boolean }; reviewerName: string
  onClose: () => void; onDone: () => void
}) {
  const { showToast } = useApp()
  const selfMode = cycleOpen && canSelfAssess(a, who)
  const managerMode = cycleOpen && canManagerAssess(a, who)
  const [goals, setGoals] = useState<Goal[]>(a.goals.length ? a.goals : selfMode ? [{ id: uid(), title: '', weight: 100 }] : [])
  const [selfComments, setSelfComments] = useState(a.selfComments)
  const [selfRating, setSelfRating] = useState(a.selfRating ? String(a.selfRating) : '')
  const [managerComments, setManagerComments] = useState(a.managerComments)
  const [managerRating, setManagerRating] = useState(a.managerRating ? String(a.managerRating) : '')
  const [strengths, setStrengths] = useState(a.strengths)
  const [improvements, setImprovements] = useState(a.improvements)
  const [saving, setSaving] = useState(false)

  const setGoal = (id: string, patchGoal: Partial<Goal>) => setGoals(gs => gs.map(g => g.id === id ? { ...g, ...patchGoal } : g))
  const score = (v: string) => (v ? Number(v) : undefined)
  const selfAvg = weightedScore(goals, 'selfScore')
  const mgrAvg = weightedScore(goals, 'managerScore')

  const submit = async (body: Record<string, unknown>) => {
    setSaving(true)
    try { await api(`/api/appraisals/${a.id}`, patch(body)); await onDone() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') }
    finally { setSaving(false) }
  }

  const scoreSelect = (value: number | undefined, onChange: (n: number | undefined) => void, disabled = false) => (
    <select className="form-input text-[11px] py-1" disabled={disabled} value={value ?? ''} onChange={e => onChange(score(e.target.value))}>
      <option value="">–</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  )

  return (
    <Modal title={`${a.employeeName}: review`} subtitle={STATUS_LABEL[a.status]} onClose={onClose} width={680}>
      <div className="flex flex-col gap-3 text-xs">
        <div>
          <div className="flex justify-between mb-1"><strong>Goals</strong>{selfMode && <button className="btn-outline text-[10px]" onClick={() => setGoals(gs => gs.length >= 12 ? gs : [...gs, { id: uid(), title: '', weight: 0 }])}>+ Add goal</button>}</div>
          {goals.length === 0 && <p style={{ color: 'var(--text-4)' }}>No goals were recorded.</p>}
          {goals.map(g => (
            <div key={g.id} className="grid gap-2 items-center py-1" style={{ gridTemplateColumns: 'minmax(0,1fr) 64px 64px 64px', borderTop: '1px solid var(--border-lt)' }}>
              {selfMode ? <Input value={g.title} onChange={v => setGoal(g.id, { title: v })} placeholder="What you set out to achieve" /> : <span>{g.title}</span>}
              {selfMode ? <input className="form-input text-[11px] py-1" type="number" min={0} max={100} value={g.weight} onChange={e => setGoal(g.id, { weight: Number(e.target.value) })} title="Weight, 0 to 100" /> : <span style={{ color: 'var(--text-4)' }}>{g.weight}%</span>}
              <div title="Self score">{scoreSelect(g.selfScore, n => setGoal(g.id, { selfScore: n }), !selfMode)}</div>
              <div title="Manager score">{scoreSelect(g.managerScore, n => setGoal(g.id, { managerScore: n }), !managerMode)}</div>
            </div>
          ))}
          {goals.length > 0 && <p className="mt-1" style={{ color: 'var(--text-4)' }}>Columns: goal, weight, self score, manager score (1 to 5). {selfAvg ? `Self ${selfAvg}` : ''}{mgrAvg ? ` · Manager ${mgrAvg}` : ''}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Your overall self-rating">{selfMode ? <Select value={selfRating} onChange={setSelfRating} options={ratingOptions} /> : <span>{a.selfRating ? `${a.selfRating}/5 · ${RATING_LABEL[a.selfRating]}` : '—'}</span>}</Field>
          <Field label="Manager's overall rating">{managerMode ? <Select value={managerRating} onChange={setManagerRating} options={ratingOptions} /> : <span>{a.managerRating ? `${a.managerRating}/5 · ${RATING_LABEL[a.managerRating]}` : '—'}</span>}</Field>
        </div>
        <Field label="Self-assessment comments">{selfMode ? <Textarea rows={3} value={selfComments} onChange={setSelfComments} placeholder="What went well, what was hard, what support you need" /> : <p className="whitespace-pre-wrap">{a.selfComments || '—'}</p>}</Field>
        {(managerMode || a.status === 'completed') && (
          <>
            <Field label="Manager's comments">{managerMode ? <Textarea rows={3} value={managerComments} onChange={setManagerComments} /> : <p className="whitespace-pre-wrap">{a.managerComments || '—'}</p>}</Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Strengths">{managerMode ? <Textarea rows={2} value={strengths} onChange={setStrengths} /> : <p className="whitespace-pre-wrap">{a.strengths || '—'}</p>}</Field>
              <Field label="To improve">{managerMode ? <Textarea rows={2} value={improvements} onChange={setImprovements} /> : <p className="whitespace-pre-wrap">{a.improvements || '—'}</p>}</Field>
            </div>
          </>
        )}
        {a.status === 'completed' && <p style={{ color: 'var(--success-text)' }}>Final rating: <strong>{a.finalRating}/5 {a.finalRating ? RATING_LABEL[a.finalRating] : ''}</strong>{a.employeeAckAt ? ` · acknowledged ${fmtDate(a.employeeAckAt)}` : ''}</p>}
      </div>

      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Close</button>
        {selfMode && <button className="btn-primary px-4 py-2 text-xs" disabled={saving} onClick={() => submit({ action: 'self', goals, selfComments, selfRating: Number(selfRating) })}>{saving ? 'Saving…' : 'Submit self-assessment'}</button>}
        {managerMode && <button className="btn-primary px-4 py-2 text-xs" disabled={saving} onClick={() => submit({ action: 'manager', goals, managerComments, managerRating: Number(managerRating), strengths, improvements, reviewerName })}>{saving ? 'Saving…' : 'Complete review'}</button>}
        {canAcknowledge(a, who) && <button className="btn-primary px-4 py-2 text-xs" disabled={saving} onClick={() => submit({ action: 'acknowledge' })}>I have read this review</button>}
      </div>
    </Modal>
  )
}
