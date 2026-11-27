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
    <div className="utf-section">
      <p>{children}</p>
      {hint ? <span>{hint}</span> : null}
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
    <Modal title={title} subtitle={subtitle} onClose={() => void closeAndSave()} width={editing ? 920 : 760} footer={footer} variant="enterprise">
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
            <div className="utf">
              <div className="utf__col">
                <SectionTitle hint={`${test.checks.filter(c => c.result).length} of ${test.checks.length} done · Pass, Fail or N/A each`}>Checklist</SectionTitle>
                <div className="utf-checks">
                  {test.checks.map(c => (
                    <div key={c.itemId} className={`utf-check${c.result === 'fail' ? ' is-fail' : ''}`}>
                      <div className="utf-check__row">
                        <p className="utf-check__label">{c.label}{c.result === 'fail' && c.cosmetic ? <span className="utf-chip">Cosmetic only</span> : null}</p>
                        <div className="utf-tri" role="radiogroup" aria-label={c.label}>
                          {(['pass', 'fail', 'na'] as const).map(r => (
                            <button key={r} type="button" role="radio" aria-checked={c.result === r}
                              className={c.result === r ? `is-${r}` : ''}
                              onClick={() => setCheck(c.itemId, { result: r, ...(r !== 'fail' ? { note: undefined, cosmetic: undefined } : {}) })}>
                              {r === 'pass' ? 'Pass' : r === 'fail' ? 'Fail' : 'N/A'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {c.result === 'fail' && (
                        <div className="utf-check__more">
                          <input className={inputCls} value={c.note ?? ''} placeholder="What is wrong — e.g. 3 dead keys (E, R, T)" onChange={e => setCheck(c.itemId, { note: e.target.value })} />
                          <label className="utf-inline">
                            <input type="checkbox" checked={!!c.cosmetic} onChange={e => setCheck(c.itemId, { cosmetic: e.target.checked })} />
                            Cosmetic only (does not block sale)
                          </label>
                        </div>
                      )}
                      {c.itemId === 'storage' && c.result !== 'na' && (
                        <div className="utf-check__more utf-check__more--narrow">
                          <NumberField label="Storage health" suffix="%" value={test.storageHealth} onChange={v => patch({ storageHealth: v })} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="utf__col">
                <SectionTitle hint={settings ? `Fails below ${settings.batteryFailBelow}% · noted below ${settings.batteryNoteBelow}%` : undefined}>Battery{test.isLaptop ? ' *' : ''}</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Health" suffix="%" value={test.batteryHealth} onChange={v => patch({ batteryHealth: v })} placeholder={test.isLaptop ? '' : 'n/a'} />
                  <NumberField label="Cycles" value={test.batteryCycles} onChange={v => patch({ batteryCycles: v })} placeholder="optional" />
                </div>
                {batteryNote ? <p className="utf-note">Passes, but shown on the label (below {settings?.batteryNoteBelow}%).</p> : null}

                <SectionTitle>Grade *</SectionTitle>
                <div className="utf-grades" role="radiogroup" aria-label="Grade">
                  {(['A', 'B', 'C'] as const).map(g => (
                    <button key={g} type="button" role="radio" aria-checked={test.grade === g} className={test.grade === g ? 'is-on' : ''}
                      onClick={() => patch({ grade: g })}>
                      <b>{g}</b><span>{GRADE_GUIDE[g].split(':')[0]}</span>
                    </button>
                  ))}
                </div>
                {test.grade ? <p className="utf-hint">{GRADE_GUIDE[test.grade]}</p> : null}

                <SectionTitle>Installations</SectionTitle>
                <input className={inputCls} value={test.installs.os ?? ''} placeholder="OS — e.g. Win 11 Pro"
                  onChange={e => patch({ installs: { ...test.installs, os: e.target.value } })} />
                <div className="utf-toggles">
                  {([['osActivated', 'Activated'], ['drivers', 'Drivers'], ['office', 'Office / apps']] as const).map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={!!test.installs[k]} className={test.installs[k] ? 'is-on' : ''}
                      onClick={() => patch({ installs: { ...test.installs, [k]: !test.installs[k] } })}>
                      {test.installs[k] ? '✓ ' : ''}{l}
                    </button>
                  ))}
                </div>

                <SectionTitle hint={unit.specs ? `On record: ${unit.specs}` : undefined}>Spec check *</SectionTitle>
                <div className="utf-spec">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-text-3">CPU</span>
                    <input className={inputCls} value={test.spec.cpu ?? ''} placeholder="i5-8365U" onChange={e => patch({ spec: { ...test.spec, cpu: e.target.value } })} />
                  </label>
                  <NumberField label="RAM" suffix="GB" value={test.spec.ramGb} onChange={v => patch({ spec: { ...test.spec, ramGb: v } })} />
                  <NumberField label="Storage" suffix="GB" value={test.spec.storageGb} onChange={v => patch({ spec: { ...test.spec, storageGb: v } })} />
                </div>
                <div className="utf-toggles" role="radiogroup" aria-label="Does the spec match the product?">
                  <button type="button" role="radio" aria-checked={test.spec.matches === true} className={test.spec.matches === true ? 'is-on' : ''}
                    onClick={() => patch({ spec: { ...test.spec, matches: true } })}>{test.spec.matches === true ? '✓ ' : ''}Matches the product</button>
                  <button type="button" role="radio" aria-checked={test.spec.matches === false} className={test.spec.matches === false ? 'is-bad' : ''}
                    onClick={() => patch({ spec: { ...test.spec, matches: false } })}>Doesn&apos;t match</button>
                </div>
                {test.spec.matches === false ? (
                  <p className="utf-note is-bad">Move it to the right product first (close this, then More → Set model &amp; specs), then confirm the spec.</p>
                ) : null}

                <SectionTitle hint="Anything the checklist didn't cover">Other issues</SectionTitle>
                <div className="flex flex-col gap-2">
                  {issues.map((i, n) => (
                    <div key={i.id} className="utf-issue">
                      <input className={inputCls} value={i.text} placeholder="e.g. Fan noisy under load"
                        onChange={e => setIssues(issues.map((x, k) => (k === n ? { ...x, text: e.target.value } : x)))} />
                      <div className="utf-tri utf-tri--sm">
                        {(['blocks_sale', 'cosmetic'] as const).map(sv => (
                          <button key={sv} type="button" className={i.severity === sv ? (sv === 'blocks_sale' ? 'is-fail' : 'is-na') : ''}
                            onClick={() => setIssues(issues.map((x, k) => (k === n ? { ...x, severity: sv } : x)))}>
                            {sv === 'blocks_sale' ? 'Blocks sale' : 'Cosmetic'}
                          </button>
                        ))}
                      </div>
                      <button type="button" className="utf-x" aria-label="Remove issue" onClick={() => setIssues(issues.filter((_, k) => k !== n))}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="utf-add" onClick={() => setIssues([...issues, { id: `i${Date.now()}`, text: '', severity: 'blocks_sale' }])}>
                    + Add issue
                  </button>
                </div>

                {live && (
                  <div className={`utf-verdict ${missing.length ? '' : live.result === 'passed' ? 'is-pass' : 'is-fail'}`} aria-live="polite">
                    {missing.length ? (
                      <>
                        <b>Result appears when the form is complete</b>
                        <ul>{missing.map(m => <li key={m}>{m}</li>)}</ul>
                      </>
                    ) : live.result === 'passed' ? (
                      <b>✓ Will PASS{test.grade ? ` · Grade ${test.grade}` : ''}{test.batteryHealth != null ? ` · Battery ${test.batteryHealth}%` : ''}</b>
                    ) : (
                      <span><b>✗ Will FAIL</b> — {live.reasons.join(' · ')}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
