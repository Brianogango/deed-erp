'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui'
import {
  compareTests,
  computeResult,
  missingForCompletion,
  summarizeTest,
  testsForSerial,
  type CheckResult,
  type UnitGrade,
  type UnitTest,
  type UnitTestIssue,
  type UnitTestSettings,
} from '@/lib/inventory/unit-tests'
import { printUnitTestLabels } from '@/lib/inventory/unit-test-label'
import { fetchUnitTestHistory, unitTestAction } from './useUnitTests'

type Unit = { id: string; serial: string; productName: string; assetId?: string; specs?: string }

const GRADE_GUIDE: Record<UnitGrade, string> = {
  A: 'Like new: no visible marks at arm’s length',
  B: 'Light wear: small scratches or scuffs',
  C: 'Visible wear: dents, deep scratches, worn keys',
}

const seg = (on: boolean, tone: 'pass' | 'fail' | 'na' | 'navy') => {
  if (!on) return 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)] hover:text-[var(--text-1)]'
  if (tone === 'pass') return 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success)]'
  if (tone === 'fail') return 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger)]'
  if (tone === 'navy') return 'bg-[var(--navy)] text-white border-[var(--navy)]'
  return 'bg-[var(--bg-muted)] text-[var(--text-2)] border-[var(--border)]'
}

const inputCls = 'w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[12px] text-text-1 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30'

function NumberField({ label, value, onChange, suffix, placeholder, disabled }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; suffix?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-3">{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" inputMode="numeric" className={inputCls} value={value ?? ''} placeholder={placeholder} disabled={disabled}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        {suffix ? <span className="text-[11px] text-text-3">{suffix}</span> : null}
      </span>
    </label>
  )
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mt-4 mb-2">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--navy)]">{children}</p>
      {hint ? <p className="text-[10px] text-text-4">{hint}</p> : null}
    </div>
  )
}

/** The finished test, read-only: what the label and the report show. */
export function UnitTestReport({ test, previous }: { test: UnitTest; previous?: UnitTest | null }) {
  const s = summarizeTest(test)
  const failed = s.headline === 'FAILED'
  const changes = previous ? compareTests(previous, test) : []
  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-lg px-3 py-2.5 border ${failed ? 'bg-[var(--danger-bg)] border-[var(--danger)]/40' : 'bg-[var(--success-bg)] border-[var(--success)]/40'}`}>
        <p className={`text-[13px] font-extrabold ${failed ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}`}>
          {failed ? '✗' : '✓'} {s.headline} <span className="font-semibold text-text-2">— Test #{test.number} · {s.dateTester}</span>
        </p>
        {failed && s.failures.length ? <p className="text-[12px] text-[var(--danger-text)] mt-1">{s.failures.join(' · ')}</p> : null}
        {s.overrideReason ? <p className="text-[12px] text-text-2 mt-1">Passed anyway by {test.override?.byName}: {s.overrideReason}</p> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {test.checks.map(c => (
          <p key={c.itemId} className="text-[12px] flex gap-1.5 min-w-0">
            <span className={c.result === 'pass' ? 'text-[var(--success-text)]' : c.result === 'fail' ? 'text-[var(--danger-text)]' : 'text-text-4'} aria-hidden="true">
              {c.result === 'pass' ? '✓' : c.result === 'fail' ? '✗' : '—'}
            </span>
            <span className="min-w-0">
              <span className={c.result === 'na' ? 'text-text-4' : 'text-text-1'}>{c.label}</span>
              {c.itemId === 'storage' && test.storageHealth != null ? <span className="text-text-3"> {test.storageHealth}%</span> : null}
              {c.result === 'na' ? <span className="text-text-4"> N/A</span> : null}
              {c.result === 'fail' && c.note ? <span className="text-[var(--danger-text)]"> — {c.note}{c.cosmetic ? ' (cosmetic)' : ''}</span> : null}
            </span>
          </p>
        ))}
      </div>
      <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-lt)] px-3 py-2 text-[12px] text-text-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
        <p><span className="text-text-4">Battery </span>{s.battery.replace(/^Battery /, '') || 'n/a'}</p>
        <p><span className="text-text-4">Grade </span>{test.grade ?? '—'}</p>
        <p className="sm:col-span-2"><span className="text-text-4">Installed </span>{s.installs || '—'}</p>
        <p className="sm:col-span-2"><span className="text-text-4">Spec confirmed </span>{s.spec || (test.spec.matches ? 'matches product' : '—')}</p>
        {s.cosmetic.length ? <p className="sm:col-span-2"><span className="text-text-4">Cosmetic notes </span>{s.cosmetic.join('; ')}</p> : null}
        {test.issues.filter(i => i.severity === 'blocks_sale').length ? (
          <p className="sm:col-span-2"><span className="text-text-4">Other issues </span>{test.issues.filter(i => i.severity === 'blocks_sale').map(i => i.text).join('; ')}</p>
        ) : null}
      </div>
      {changes.length > 0 && previous ? (
        <div className="rounded-lg border border-[var(--border-lt)] overflow-hidden">
          <p className="px-3 py-1.5 text-[11px] font-bold bg-[var(--bg-surface)] text-text-2">Since test #{previous.number}</p>
          <table className="w-full text-[12px]">
            <tbody>
              {changes.map(c => (
                <tr key={c.what} className="border-t border-[var(--border-lt)]">
                  <td className="px-3 py-1 text-text-2">{c.what}</td>
                  <td className="px-3 py-1 text-text-3">{c.before}</td>
                  <td className="px-3 py-1 text-text-1 font-semibold">{c.after}{c.fixed ? <span className="ml-1.5 text-[10px] font-bold text-[var(--success-text)]">fixed</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The test bench form for one unit. Opens the unit's open test (or puts it
 * on the bench), saves as it goes, and on finish works out PASSED/FAILED
 * and prints the bench label.
 */
export default function UnitTestForm({ unit, onClose, onChanged, canRecord, canOverride, notify, finalForJobId, onFinished }: {
  unit: Unit
  onClose: () => void
  onChanged: () => void
  canRecord: boolean
  canOverride: boolean
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** The final test of a refurbishment job (done in the job, not at the bench). */
  finalForJobId?: string
  /** Called once the test is finished (the job then sends the unit on). */
  onFinished?: (test: UnitTest) => void
}) {
  const [test, setTest] = useState<UnitTest | null>(null)
  const [history, setHistory] = useState<UnitTest[]>([])
  const [settings, setSettings] = useState<UnitTestSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const h = await fetchUnitTestHistory(unit.id)
      if (!live) return
      if (!h) { setError('Could not load this unit’s tests.'); return }
      setSettings(h.settings)
      const mine = testsForSerial(h.tests, unit.id)
      setHistory(mine)
      if (finalForJobId) {
        const r = await unitTestAction({ action: 'start_final', jobId: finalForJobId })
        if (!live) return
        if (!r.ok) { setError(r.error); return }
        setTest(r.data.test)
        // Finished earlier but never sent on (closed the window): finish now.
        if (r.data.test.status === 'completed') onFinished?.(r.data.test)
        onChanged()
        return
      }
      const open = mine.find(t => t.status === 'in_progress') ?? mine.find(t => t.status === 'completed')
      if (open) { setTest(open); return }
      if (!canRecord) { setError('This unit has not been tested yet.'); return }
      const r = await unitTestAction({ action: 'start', serialId: unit.id })
      if (!live) return
      if (!r.ok) { setError(r.error); return }
      setTest(r.data.test)
      onChanged()
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id])

  const previous = useMemo(() => (test ? history.find(t => t.number < test.number && (t.status === 'placed' || t.status === 'completed')) ?? null : null), [history, test])
  const editing = test?.status === 'in_progress' && canRecord
  const live = useMemo(() => (test && settings ? computeResult(test, settings) : null), [test, settings])
  const missing = useMemo(() => (test ? missingForCompletion(test) : []), [test])
  const batteryNote = test && settings && test.batteryHealth != null && test.batteryHealth >= settings.batteryFailBelow && test.batteryHealth < settings.batteryNoteBelow

  const patch = (p: Partial<UnitTest>) => { setTest(t => (t ? { ...t, ...p } : t)); setDirty(true) }
  const setCheck = (itemId: string, p: { result?: CheckResult | null; note?: string; cosmetic?: boolean }) => {
    setTest(t => (t ? { ...t, checks: t.checks.map(c => (c.itemId === itemId ? { ...c, ...p } : c)) } : t))
    setDirty(true)
  }

  const formPatch = (t: UnitTest): Partial<UnitTest> => ({
    checks: t.checks, batteryHealth: t.batteryHealth, batteryCycles: t.batteryCycles, storageHealth: t.storageHealth,
    grade: t.grade, installs: t.installs, spec: t.spec, issues: t.issues,
  })

  async function run(body: Record<string, unknown>, okMsg?: string): Promise<UnitTest | null> {
    setBusy(true)
    const r = await unitTestAction(body)
    setBusy(false)
    if (!r.ok) { notify(r.error, 'error'); return null }
    setTest(r.data.test)
    setDirty(false)
    onChanged()
    if (okMsg) notify(okMsg)
    return r.data.test
  }

  const save = () => test && run({ action: 'save', testId: test.id, patch: formPatch(test) }, 'Test saved')
  async function finish() {
    if (!test) return
    if (missing.length) { notify(`Not finished: ${missing[0]}`, 'error'); return }
    const done = await run({ action: 'complete', testId: test.id, patch: formPatch(test) })
    if (done) {
      if (onFinished) { onFinished(done); return }
      notify(done.result === 'passed' ? `${unit.serial} PASSED — label printing` : `${unit.serial} FAILED — label printing`, done.result === 'passed' ? 'success' : 'info')
      void printUnitTestLabels([done])
    }
  }
  async function closeAndSave() {
    if (editing && dirty && test) await run({ action: 'save', testId: test.id, patch: formPatch(test) })
    onClose()
  }

  const issues = test?.issues ?? []
  const setIssues = (next: UnitTestIssue[]) => patch({ issues: next })

  const title = `${finalForJobId ? 'Final test' : 'Test bench'} — ${unit.assetId || unit.serial}`
  const subtitle = `${unit.productName}${unit.assetId && unit.serial !== unit.assetId ? ` · S/N ${unit.serial}` : ''}${test ? ` · Test #${test.number}` : ''}`

  const footer = !test ? null : editing ? (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <button type="button" className="btn-outline text-[12px]" disabled={busy}
        onClick={async () => { if (await run({ action: 'cancel', testId: test.id, reason: 'Taken off the bench' }, 'Taken off the bench')) onClose() }}>
        Take off bench
      </button>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-[12px]" disabled={busy || !dirty} onClick={() => void save()}>Save</button>
        <button type="button" className="btn-primary text-[12px]" disabled={busy} onClick={() => void finish()}>
          Finish &amp; print label
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="flex gap-2">
        {test.status === 'completed' && canRecord ? (
          <button type="button" className="btn-outline text-[12px]" disabled={busy} onClick={() => void run({ action: 'reopen', testId: test.id }, 'Test reopened')}>Reopen to correct</button>
        ) : null}
        {test.status === 'completed' && test.result === 'failed' && !test.override && canOverride ? (
          <button type="button" className="btn-outline text-[12px]" onClick={() => setShowOverride(v => !v)}>Pass anyway…</button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-[12px]" onClick={() => void printUnitTestLabels([test])}>Print test label</button>
        <a className="btn-secondary text-[12px]" href={`/inventory/unit-test/${encodeURIComponent(unit.id)}`} target="_blank" rel="noreferrer">Full report</a>
        <button type="button" className="btn-primary text-[12px]" onClick={onClose}>Done</button>
      </div>
    </div>
  )

  return (
    <Modal title={title} subtitle={subtitle} onClose={() => void closeAndSave()} width={760} footer={footer} variant="enterprise">
      {error ? <p className="text-[12px] text-[var(--danger-text)]">{error}</p> : null}
      {!test && !error ? <p className="text-[12px] text-text-3">Loading…</p> : null}
      {test && (
        <div className="flex flex-col">
          {(test.source === 'retest_after_repair' || test.source === 'refurb_final' || previous) && (
            <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary-light)] px-3 py-2 mb-2">
              <p className="text-[12px] font-bold text-[var(--navy)]">
                {test.source === 'refurb_final' ? `Final test of ${test.refurbJobRef ?? 'the repair'} — same checks as the test bench` : test.source === 'retest_after_repair' ? `Retest after repair${test.refurbJobRef ? ` (${test.refurbJobRef})` : ''}` : 'Tested before'}
              </p>
              {previous ? (
                <p className="text-[11px] text-text-2 mt-0.5">
                  Test #{previous.number}: {summarizeTest(previous).headline}
                  {previous.failReasons?.length ? ` — check these first: ${previous.failReasons.join(' · ')}` : ''}
                </p>
              ) : null}
            </div>
          )}

          {!editing ? (
            <>
              <UnitTestReport test={test} previous={previous} />
              {showOverride && (
                <div className="mt-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-bg)] p-3">
                  <p className="text-[12px] font-bold text-[var(--warning-text)]">Pass this unit anyway</p>
                  <p className="text-[11px] text-text-2 mt-0.5">The reason is printed on the label and kept on the unit&apos;s history (e.g. “Sell at KES 5,000 off — battery 55% disclosed”).</p>
                  <textarea className={`${inputCls} mt-2`} rows={2} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Reason" />
                  <div className="flex justify-end mt-2">
                    <button type="button" className="btn-primary text-[12px]" disabled={busy || overrideReason.trim().length < 5}
                      onClick={async () => {
                        const t = await run({ action: 'override', testId: test.id, reason: overrideReason }, 'Passed anyway — reason recorded')
                        if (t) { setShowOverride(false); void printUnitTestLabels([t]) }
                      }}>
                      Pass anyway &amp; reprint label
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <SectionTitle hint="Every line needs Pass, Fail or N/A">Checklist</SectionTitle>
              <div className="rounded-lg border border-[var(--border-lt)] divide-y divide-[var(--border-lt)]">
                {test.checks.map(c => (
                  <div key={c.itemId} className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-text-1 min-w-0">{c.label}</p>
                      <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
                        {(['pass', 'fail', 'na'] as const).map(r => (
                          <button key={r} type="button" role="radio" aria-checked={c.result === r}
                            className={`min-h-[32px] px-3 rounded-md border text-[11px] font-bold transition-colors ${seg(c.result === r, r)}`}
                            onClick={() => setCheck(c.itemId, { result: r, ...(r !== 'fail' ? { note: undefined, cosmetic: undefined } : {}) })}>
                            {r === 'pass' ? 'Pass' : r === 'fail' ? 'Fail' : 'N/A'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {c.result === 'fail' && (
                      <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                        <input className={inputCls} value={c.note ?? ''} placeholder="What is wrong — e.g. 3 dead keys (E, R, T)" onChange={e => setCheck(c.itemId, { note: e.target.value })} />
                        <label className="flex items-center gap-1.5 text-[11px] text-text-2 whitespace-nowrap">
                          <input type="checkbox" checked={!!c.cosmetic} onChange={e => setCheck(c.itemId, { cosmetic: e.target.checked })} />
                          Cosmetic only (does not block sale)
                        </label>
                      </div>
                    )}
                    {c.itemId === 'storage' && c.result !== 'na' && (
                      <div className="mt-2 max-w-[180px]">
                        <NumberField label="Storage health" suffix="%" value={test.storageHealth} onChange={v => patch({ storageHealth: v })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <SectionTitle hint={settings ? `Fails below ${settings.batteryFailBelow}%` : undefined}>Battery{test.isLaptop ? ' *' : ''}</SectionTitle>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Health" suffix="%" value={test.batteryHealth} onChange={v => patch({ batteryHealth: v })} placeholder={test.isLaptop ? '' : 'n/a'} />
                    <NumberField label="Cycles" value={test.batteryCycles} onChange={v => patch({ batteryCycles: v })} placeholder="optional" />
                  </div>
                  {batteryNote ? <p className="text-[11px] text-[var(--warning-text)] mt-1">Passes, but shown on the label (below {settings?.batteryNoteBelow}%).</p> : null}
                </div>
                <div>
                  <SectionTitle>Grade *</SectionTitle>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Grade">
                    {(['A', 'B', 'C'] as const).map(g => (
                      <button key={g} type="button" role="radio" aria-checked={test.grade === g} title={GRADE_GUIDE[g]}
                        className={`flex-1 min-h-[36px] rounded-md border text-[13px] font-extrabold transition-colors ${seg(test.grade === g, 'navy')}`}
                        onClick={() => patch({ grade: g })}>
                        {g}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-text-3 mt-1">{test.grade ? GRADE_GUIDE[test.grade] : 'Cosmetic condition — hover for the guide'}</p>
                </div>
              </div>

              <SectionTitle>Installations</SectionTitle>
              <div className="flex flex-wrap items-center gap-3">
                <input className={`${inputCls} max-w-[200px]`} value={test.installs.os ?? ''} placeholder="OS — e.g. Win 11 Pro"
                  onChange={e => patch({ installs: { ...test.installs, os: e.target.value } })} />
                {([['osActivated', 'Activated'], ['drivers', 'Drivers'], ['office', 'Office / apps']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5 text-[12px] text-text-2">
                    <input type="checkbox" checked={!!test.installs[k]} onChange={e => patch({ installs: { ...test.installs, [k]: e.target.checked } })} />
                    {l}
                  </label>
                ))}
              </div>

              <SectionTitle hint={unit.specs ? `On record: ${unit.specs}` : undefined}>Spec check *</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-text-3">CPU</span>
                  <input className={inputCls} value={test.spec.cpu ?? ''} placeholder="i5-8365U" onChange={e => patch({ spec: { ...test.spec, cpu: e.target.value } })} />
                </label>
                <NumberField label="RAM" suffix="GB" value={test.spec.ramGb} onChange={v => patch({ spec: { ...test.spec, ramGb: v } })} />
                <NumberField label="Storage" suffix="GB" value={test.spec.storageGb} onChange={v => patch({ spec: { ...test.spec, storageGb: v } })} />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2" role="radiogroup" aria-label="Does the spec match the product?">
                <button type="button" role="radio" aria-checked={test.spec.matches === true}
                  className={`min-h-[32px] px-3 rounded-md border text-[11px] font-bold ${seg(test.spec.matches === true, 'pass')}`}
                  onClick={() => patch({ spec: { ...test.spec, matches: true } })}>Matches {unit.productName.length > 40 ? 'the product' : unit.productName}</button>
                <button type="button" role="radio" aria-checked={test.spec.matches === false}
                  className={`min-h-[32px] px-3 rounded-md border text-[11px] font-bold ${seg(test.spec.matches === false, 'fail')}`}
                  onClick={() => patch({ spec: { ...test.spec, matches: false } })}>Doesn&apos;t match</button>
              </div>
              {test.spec.matches === false ? (
                <p className="text-[11px] text-[var(--danger-text)] mt-1">Move it to the right product first (close this, then More → Set model &amp; specs), then confirm the spec.</p>
              ) : null}

              <SectionTitle hint="Anything the checklist didn't cover">Other issues</SectionTitle>
              <div className="flex flex-col gap-2">
                {issues.map((i, n) => (
                  <div key={i.id} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input className={inputCls} value={i.text} placeholder="e.g. Fan noisy under load"
                      onChange={e => setIssues(issues.map((x, k) => (k === n ? { ...x, text: e.target.value } : x)))} />
                    <div className="flex gap-1 shrink-0">
                      {(['blocks_sale', 'cosmetic'] as const).map(sv => (
                        <button key={sv} type="button" className={`min-h-[32px] px-2.5 rounded-md border text-[11px] font-bold ${seg(i.severity === sv, sv === 'blocks_sale' ? 'fail' : 'na')}`}
                          onClick={() => setIssues(issues.map((x, k) => (k === n ? { ...x, severity: sv } : x)))}>
                          {sv === 'blocks_sale' ? 'Blocks sale' : 'Cosmetic'}
                        </button>
                      ))}
                      <button type="button" className="min-h-[32px] px-2 text-[11px] text-text-3 hover:text-[var(--danger-text)]" aria-label="Remove issue"
                        onClick={() => setIssues(issues.filter((_, k) => k !== n))}>✕</button>
                    </div>
                  </div>
                ))}
                <button type="button" className="self-start text-[12px] font-semibold text-[var(--navy)] hover:underline"
                  onClick={() => setIssues([...issues, { id: `i${Date.now()}`, text: '', severity: 'blocks_sale' }])}>
                  + Add issue
                </button>
              </div>

              {live && (
                <div className={`mt-4 rounded-lg px-3 py-2.5 border ${missing.length ? 'bg-[var(--bg-surface)] border-[var(--border-lt)]' : live.result === 'passed' ? 'bg-[var(--success-bg)] border-[var(--success)]/40' : 'bg-[var(--danger-bg)] border-[var(--danger)]/40'}`} aria-live="polite">
                  {missing.length ? (
                    <>
                      <p className="text-[12px] font-bold text-text-2">Result appears when the form is complete</p>
                      <ul className="mt-1 text-[11px] text-text-3 list-disc pl-4">{missing.map(m => <li key={m}>{m}</li>)}</ul>
                    </>
                  ) : live.result === 'passed' ? (
                    <p className="text-[13px] font-extrabold text-[var(--success-text)]">✓ PASSED{test.grade ? ` · Grade ${test.grade}` : ''}{test.batteryHealth != null ? ` · Battery ${test.batteryHealth}%` : ''}</p>
                  ) : (
                    <p className="text-[13px] font-extrabold text-[var(--danger-text)]">✗ FAILED — {live.reasons.join(' · ')}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
