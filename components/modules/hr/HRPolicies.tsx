'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { hasAcknowledged, policyCoverage, policyVersion, type AckLike } from '@/lib/hr/policies'

interface Ack extends AckLike { id: string; policyTitle: string; acknowledgedAt: string }

/** HR policies are the reference documents filed under the HR category. */
function useHrPolicies() {
  const { refSops } = useApp()
  return useMemo(() => (refSops ?? []).filter(s => s.category === 'hr'), [refSops])
}

/** "My portal" card: read each HR policy and accept it. Accepting is recorded against the current version. */
export function MyPolicies() {
  const { showToast } = useApp()
  const policies = useHrPolicies()
  const [acks, setAcks] = useState<Ack[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { employees } = useHrStore()
  const { currentUser } = useApp()
  const me = employees.find(e => e.userId === currentUser?.id) ?? null

  useEffect(() => {
    fetch('/api/policy-acknowledgements', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then(setAcks)
      .catch(() => setAcks([]))
  }, [])

  const accept = async (id: string) => {
    const p = policies.find(x => x.id === id)
    if (!p) return
    setBusy(id)
    try {
      const res = await fetch('/api/policy-acknowledgements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policyId: p.id, policyTitle: p.title, policyVersion: policyVersion(p) }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Could not record your acceptance')
      setAcks(prev => [...(prev ?? []), body])
      showToast(`You accepted "${p.title}"`, 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not record your acceptance', 'error') }
    finally { setBusy(null) }
  }

  if (policies.length === 0) return null
  const mine = me?.id ?? 'self'
  const withEmployee = (acks ?? []).map(a => ({ ...a, employeeId: mine }))
  const pending = policies.filter(p => !hasAcknowledged(withEmployee, mine, p)).length

  return (
    <div className="hr-policies card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Company policies</h3>
        <span className="text-[11px]" style={{ color: pending ? 'var(--warning-text)' : 'var(--success-text)' }}>{acks === null ? '…' : pending ? `${pending} to accept` : 'All accepted'}</span>
      </div>
      {policies.map(p => {
        const done = hasAcknowledged(withEmployee, mine, p)
        const ack = (acks ?? []).find(a => a.policyId === p.id && a.policyVersion === policyVersion(p))
        return (
          <div key={p.id} className="py-2" style={{ borderTop: '1px solid var(--border-lt)' }}>
            <div className="flex items-center justify-between gap-3">
              <button type="button" className="text-xs font-semibold text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>{p.title}</button>
              {done
                ? <span className="text-[10px]" style={{ color: 'var(--success-text)' }}>Accepted {ack ? fmtDate(ack.acknowledgedAt) : ''}</span>
                : <button className="btn-primary text-[10px]" disabled={busy === p.id || acks === null} onClick={() => accept(p.id)}>{busy === p.id ? 'Saving…' : 'I have read and accept'}</button>}
            </div>
            {open === p.id && <div className="mt-2 text-xs whitespace-pre-wrap rounded-lg p-3" style={{ background: 'var(--bg-muted)', color: 'var(--text-2)', maxHeight: 280, overflowY: 'auto' }}>{p.content || 'Open the Documents module to read the attached file.'}</div>}
          </div>
        )
      })}
    </div>
  )
}

/** HR view: how many people accepted each current policy, and who has not. */
export function PolicyAckReport() {
  const policies = useHrPolicies()
  const { employees } = useHrStore()
  const [acks, setAcks] = useState<Ack[] | null>(null)
  const load = useCallback(() => {
    fetch('/api/policy-acknowledgements?scope=all', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).then(setAcks).catch(() => setAcks([]))
  }, [])
  useEffect(() => { load() }, [load])
  const coverage = useMemo(() => policyCoverage(policies, acks ?? [], employees), [policies, acks, employees])

  if (policies.length === 0) return null
  return (
    <div className="hr-report-card rounded-xl border border-[var(--border-lt)] p-4">
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>Policy sign-off</h3>
      {acks === null && <p className="text-xs" style={{ color: 'var(--text-4)' }}>Loading…</p>}
      {coverage.map(c => (
        <div key={c.policy.id} className="py-2 text-xs" style={{ borderTop: '1px solid var(--border-lt)' }}>
          <div className="flex justify-between"><span className="font-semibold">{c.policy.title}</span><span>{c.acknowledged} of {c.total} accepted</span></div>
          {c.missing.length > 0 && <p style={{ color: 'var(--text-4)' }}>Not yet: {c.missing.join(', ')}</p>}
        </div>
      ))}
    </div>
  )
}
