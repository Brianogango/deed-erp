'use client'

import { useCallback, useEffect, useState } from 'react'
import { PrimaryActionButton } from '@/components/erp'
import { PanelHeader, EmptyState } from '@/components/ui'

type ReviewLead = {
  id: string
  name: string
  companyName?: string | null
  email?: string | null
  stage: string
  emailSubject?: string | null
  emailSnippet?: string | null
  notes?: string | null
  createdAt: string
  owner?: { username?: string | null } | null
}

type InboundRow = {
  id: string
  fromEmail?: string | null
  fromName?: string | null
  subject?: string | null
  processingStatus: string
  processingReason?: string | null
  classification?: string | null
  confidence?: number | string | null
  decision?: string | null
  leadId?: string | null
  createdAt: string
}

export default function EmailReviewPanel({
  showToast,
  salesReps,
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  salesReps: { id: string; name: string }[]
}) {
  // Filter starts empty (= all statuses); the user narrows it down.
  const [status, setStatus] = useState('')
  const [inbound, setInbound] = useState<InboundRow[]>([])
  const [reviewLeads, setReviewLeads] = useState<ReviewLead[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dryRunBusy, setDryRunBusy] = useState(false)
  const [dryRunSummary, setDryRunSummary] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/crm/email-review?status=${encodeURIComponent(status || 'all')}`)
      if (!res.ok) throw new Error('Failed to load review queue')
      const data = await res.json()
      setInbound(Array.isArray(data.inbound) ? data.inbound : [])
      setReviewLeads(Array.isArray(data.reviewLeads) ? data.reviewLeads : [])
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, status])

  useEffect(() => { void load() }, [load])

  const act = async (leadId: string, action: 'accept' | 'reject' | 'non_sales') => {
    setBusyId(leadId)
    try {
      const res = await fetch('/api/crm/email-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Action failed')
      showToast(action === 'accept' ? 'Lead accepted' : 'Lead closed', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const runDryReport = async () => {
    setDryRunBusy(true)
    setDryRunSummary(null)
    try {
      const res = await fetch('/api/cron/sales-inbox-dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackHours: 72, limit: 40 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Dry-run failed')
      const s = data.report?.summary
      setDryRunSummary(
        s
          ? `Fetched ${s.fetched} · would create ${s.wouldCreate} · review ${s.wouldReview} · link ${s.wouldLink} · hard skip ${s.wouldSkipHard} · non-sales ${s.wouldSkipNonSales}`
          : 'Report ready',
      )
      showToast('Dry-run report ready', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Dry-run failed', 'error')
    } finally {
      setDryRunBusy(false)
    }
  }

  return (
    <div className="crm-email-review flex flex-col gap-4">
      <div className="card overflow-hidden">
        <PanelHeader title="Email review">
          <select className="form-select text-xs py-1.5" aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="REVIEW_REQUIRED">Review required</option>
            <option value="LEAD_CREATED">Created</option>
            <option value="FILTERED">Filtered</option>
            <option value="NON_SALES">Non-sales</option>
            <option value="CLASSIFIED">Classified (shadow)</option>
          </select>
          <PrimaryActionButton onClick={() => void load()} disabled={loading}>Refresh</PrimaryActionButton>
          <button type="button" disabled={dryRunBusy} onClick={() => void runDryReport()} className="btn-outline text-[11px]">
            {dryRunBusy ? 'Running…' : '72h dry-run'}
          </button>
        </PanelHeader>
        <p className="px-4 py-2.5 text-[11px] text-text-3">
          Medium-confidence inbound mail and classifier failures. Accept to assign; reject or mark non-sales to close.
        </p>
      </div>

      {dryRunSummary && (
        <div className="card px-4 py-2.5 text-xs text-text-2">
          {dryRunSummary}
        </div>
      )}

      <div className="card overflow-hidden crm-directory-card">
        <PanelHeader title="Needs review leads" count={reviewLeads.length} />
        {loading ? (
          <EmptyState title="Loading…" />
        ) : reviewLeads.length === 0 ? (
          <EmptyState title="No leads waiting for review" />
        ) : (
          <ul className="divide-y divide-border">
            {reviewLeads.map(row => (
              <li key={row.id} className="crm-review-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{row.name}</div>
                  <div className="text-[11px] text-text-3 truncate">
                    {row.companyName || row.email || '—'}
                    {row.emailSubject ? ` · ${row.emailSubject}` : ''}
                  </div>
                  <div className="text-[10px] text-text-3 mt-0.5">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void act(row.id, 'accept')}
                    className="btn-outline text-[11px] py-1 px-2.5"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void act(row.id, 'non_sales')}
                    className="btn-outline text-[11px] py-1 px-2.5"
                  >
                    Not sales
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void act(row.id, 'reject')}
                    className="btn-outline text-[11px] py-1 px-2.5"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-hidden crm-directory-card">
        <PanelHeader title="Inbound audit" count={inbound.length} />
        {loading ? (
          <EmptyState title="Loading…" />
        ) : inbound.length === 0 ? (
          <EmptyState title="No inbound rows for this filter" subtitle="Try another status filter." />
        ) : (
          <ul className="divide-y divide-border">
            {inbound.map(row => (
              <li key={row.id} className="crm-review-row crm-review-row--inbound">
                <div className="min-w-0">
                  <div className="text-sm truncate">{row.fromName || row.fromEmail || '—'}</div>
                  <div className="text-[11px] text-text-3 truncate">{row.fromEmail}</div>
                  <div className="text-xs text-text-2 mt-0.5 truncate max-w-[420px]">{row.subject || '—'}</div>
                </div>
                <div className="text-[11px] text-right shrink-0">
                  <div>{row.classification || '—'}</div>
                  <div className="text-text-3">{row.decision || row.processingStatus}</div>
                  <div className="tabular-nums text-text-3">
                    {row.confidence == null ? '—' : Number(row.confidence).toFixed(2)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {salesReps.length === 0 && (
        <p className="text-[11px] text-text-3">No directors or sales reps available for auto-assign on accept.</p>
      )}
    </div>
  )
}
