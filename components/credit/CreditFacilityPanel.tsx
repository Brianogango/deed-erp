'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, StatusStepper } from '@/components/ui'
import { fmtDate, fmtDateTime, fmtKes } from '@/lib/store'
import { normalizeClientRole } from '@/lib/auth/access'
import {
  ACTION_ROLES, DECIDED_STATUSES, FINANCE_APPROVAL_LIMIT, MIN_PAID_TRANSACTIONS, STANDARD_TERMS_DAYS, STATUS_LABELS,
  TRANSITIONS, type CreditAction, type CreditFacilityStatus,
} from '@/lib/credit/credit-facility-rules'
import { BUSINESS_FIELDS, BUSINESS_TYPES, GROUPS, PAYMENT_METHODS, STAKEHOLDERS, type FieldDef, type GroupDef } from '@/lib/credit/credit-form-fields'

type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void
type Json = Record<string, any>

type ChecklistItem = { kind: string; label: string; required: boolean; expires: boolean; hint?: string; state: string; missingExpiry: boolean }
type Doc = { id: string; kind: string; name: string; status: string; expiresOn: string | null; note: string | null; uploadedBy: string | null; uploadedVia: string; reviewedBy: string | null; createdAt: string }
export type CreditApplicationView = {
  id: string; ref: string; clientId: string; status: CreditFacilityStatus
  client: { id: string; name: string; email: string | null; phone: string | null; kraPin: string | null; creditLimit: number; paymentTermsDays: number | null; creditStatus: string; creditReviewDue: string | null } | null
  requestedLimit: number; requestedTermsDays: number
  form: Json; assessment: Json; riskClass: string | null
  recommendedLimit: number | null; recommendedTermsDays: number | null
  approvedLimit: number | null; approvedTermsDays: number | null
  conditions: string | null; decisionNote: string | null
  requestedBy: string | null; requestedById: string | null; recommendedBy: string | null; decidedBy: string | null; decidedAt: string | null
  reviewDue: string | null
  portalLink?: { url: string; expiresAt: string | null; expired: boolean } | null
  events: Array<{ at: string; byName: string | null; action: string; note?: string }>
  documents: Doc[]
  paidTransactions?: number
  checklist?: ChecklistItem[]
  approval?: { blockers: string[]; level: 'finance_officer' | 'director'; policyException: boolean }
  createdAt: string; updatedAt: string
}

export const CREDIT_STANDING_LABELS: Record<string, string> = {
  none: 'Pay on receipt',
  approved: 'Credit approved',
  suspended: 'Credit suspended',
  revoked: 'Credit revoked',
  legacy: 'Credit given before applications — review due',
}

const STEPS: CreditFacilityStatus[] = ['draft', 'sent', 'submitted', 'under_review', 'recommended', 'approved']

const ACTION_LABELS: Record<CreditAction, string> = {
  mark_sent: 'Mark pack sent to client',
  submit: 'Submit to Finance',
  start_review: 'Start credit check',
  request_info: 'Request more information',
  recommend: 'Recommend to director',
  approve: 'Approve credit',
  decline: 'Decline',
  withdraw: 'Withdraw',
  suspend: 'Suspend credit',
  reinstate: 'Reinstate credit',
  revoke: 'Revoke credit',
}
const NOTE_REQUIRED = new Set<CreditAction>(['request_info', 'decline', 'suspend', 'revoke'])

// ── Finance's credit check (Credit Check checklist) ───────────────────────
const CHECK_FLAGS: Array<[string, string]> = [
  ['financialsReviewed', 'Financial statements reviewed (last two years)'],
  ['bankStatementsReviewed', 'Bank statements reviewed — cash flow and liquidity'],
  ['taxCompliant', 'Tax compliance confirmed'],
  ['creditBureauChecked', 'Credit bureau report obtained'],
  ['courtRecordsClear', 'No legal actions, bankruptcies or judgments found'],
  ['bankReferenceVerified', 'Bank reference verified with the bank'],
]
const CHECK_NOTES: Array<[string, string]> = [
  ['creditBureauNote', 'Credit score / bureau findings'],
  ['outstandingDebtsNote', 'Outstanding loans, debts or liens'],
  ['debtToEquity', 'Debt-to-equity ratio'],
  ['bankReferenceNote', "Bank's feedback on how the client manages credit"],
  ['tradeReferencesNote', 'Trade references — timeliness, limits, length of relationship'],
  ['notes', 'Other findings'],
]

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`)
  return body
}

const inputCls = 'w-full rounded-lg border border-border-lt bg-card px-2.5 py-1.5 text-xs text-text-1 disabled:bg-muted disabled:text-text-3'
const labelCls = 'block text-[11px] font-semibold text-text-3 mb-1'
const sectionCls = 'rounded-2xl border border-border-lt bg-card p-4'

function TextField({ def, value, disabled, onChange }: { def: FieldDef; value: unknown; disabled: boolean; onChange: (v: string) => void }) {
  const v = value == null ? '' : String(value)
  return (
    <label className={def.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <span className={labelCls}>{def.label}</span>
      {def.type === 'textarea'
        ? <textarea className={inputCls} rows={2} value={v} disabled={disabled} onChange={e => onChange(e.target.value)} />
        : <input className={inputCls} type={def.type ?? 'text'} value={v} disabled={disabled} onChange={e => onChange(e.target.value)} />}
    </label>
  )
}

/**
 * A customer's credit applications: the form, documents, Finance's credit
 * check and the decision. Used on the customer (Contacts → Credit) and in
 * Finance's credit queue.
 */
export default function CreditFacilityPanel({ clientId, clientName, role, userId, showToast, onChanged, initialApplicationId }: {
  clientId: string
  initialApplicationId?: string
  clientName?: string
  role: string | null | undefined
  userId?: string | null
  showToast: Toast
  onChanged?: () => void
}) {
  const r = normalizeClientRole(role)
  const isFinance = r === 'finance_officer' || r === 'director'
  const [apps, setApps] = useState<CreditApplicationView[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CreditApplicationView | null>(null)
  const [busy, setBusy] = useState(false)
  const [newLimit, setNewLimit] = useState('')
  const [newTerms, setNewTerms] = useState(String(STANDARD_TERMS_DAYS))
  const [form, setForm] = useState<Json>({})
  const [assessment, setAssessment] = useState<Json>({})
  const [decision, setDecision] = useState<Json>({})
  const [formDirty, setFormDirty] = useState(false)
  const [checkDirty, setCheckDirty] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const body = await call(`/api/credit-applications?clientId=${encodeURIComponent(clientId)}`)
      const list = (body?.applications ?? []) as CreditApplicationView[]
      setApps(list)
      setSelectedId(prev => prev && list.some(a => a.id === prev) ? prev : list.find(a => a.id === initialApplicationId)?.id ?? list[0]?.id ?? null)
    } catch (err) {
      setApps([])
      showToast(`Could not load credit applications: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }, [clientId, showToast, initialApplicationId])

  const adopt = useCallback((app: CreditApplicationView) => {
    setDetail(app)
    setForm(app.form ?? {})
    setAssessment(app.assessment ?? {})
    setDecision({
      riskClass: app.riskClass ?? '',
      recommendedLimit: app.recommendedLimit ?? '',
      recommendedTermsDays: app.recommendedTermsDays ?? '',
      conditions: app.conditions ?? '',
      approvedLimit: app.approvedLimit ?? app.recommendedLimit ?? app.requestedLimit,
      approvedTermsDays: app.approvedTermsDays ?? app.recommendedTermsDays ?? app.requestedTermsDays,
    })
    setFormDirty(false)
    setCheckDirty(false)
    setApps(prev => prev?.map(a => a.id === app.id ? { ...a, status: app.status, ref: app.ref } : a) ?? prev)
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let live = true
    call(`/api/credit-applications/${selectedId}`)
      .then(body => { if (live && body?.application) adopt(body.application) })
      .catch(err => showToast(`Could not open the application: ${err instanceof Error ? err.message : 'error'}`, 'error'))
    return () => { live = false }
  }, [selectedId, adopt, showToast])

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(true)
    try {
      const body = await fn()
      if (body?.application) adopt(body.application)
      showToast(label, 'success')
      onChanged?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setBusy(false)
    }
  }

  const start = () => run('Credit application started', async () => {
    const body = await call('/api/credit-applications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, requestedLimit: Number(newLimit) || 0, requestedTermsDays: Number(newTerms) || STANDARD_TERMS_DAYS }),
    })
    await loadList()
    setSelectedId(body.application.id)
    return body
  })

  const open = detail && !DECIDED_STATUSES.includes(detail.status)
  const editableForm = Boolean(open)
  const setField = (key: string, v: unknown) => { setForm(f => ({ ...f, [key]: v })); setFormDirty(true) }
  const groupRows = (g: GroupDef): Json[] => {
    const rows = Array.isArray(form[g.key]) ? form[g.key] as Json[] : []
    return rows.length >= g.min ? rows : [...rows, ...Array.from({ length: g.min - rows.length }, () => ({}))]
  }
  const setGroup = (g: GroupDef, i: number, key: string, v: string) => {
    const rows = groupRows(g).map((row, j) => j === i ? { ...row, [key]: v } : row)
    setField(g.key, rows)
  }

  const prefill = () => {
    const c = detail?.client
    if (!c) return
    setForm(f => ({
      ...f,
      registeredName: f.registeredName || c.name,
      email: f.email || c.email || '',
      telephone: f.telephone || c.phone || '',
      taxPin: f.taxPin || c.kraPin || '',
    }))
    setFormDirty(true)
  }

  const saveForm = () => detail && run('Application form saved', () => call(`/api/credit-applications/${detail.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form, requestedLimit: detail.requestedLimit, requestedTermsDays: detail.requestedTermsDays }),
  }))
  const saveRequested = (limit: number, terms: number) => detail && run('Requested credit updated', () => call(`/api/credit-applications/${detail.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedLimit: limit, requestedTermsDays: terms }),
  }))
  const saveCheck = () => detail && run('Credit check saved', () => call(`/api/credit-applications/${detail.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assessment, riskClass: decision.riskClass || null, recommendedLimit: decision.recommendedLimit, recommendedTermsDays: decision.recommendedTermsDays, conditions: decision.conditions }),
  }))

  const act = async (action: CreditAction) => {
    if (!detail) return
    if (checkDirty || formDirty) { showToast('Save your changes first', 'info'); return }
    let note: string | null = null
    if (NOTE_REQUIRED.has(action)) {
      note = window.prompt(`${ACTION_LABELS[action]} — say why (the requester sees this):`)
      if (!note?.trim()) return
    } else if (action === 'approve' || action === 'recommend') {
      const limit = Number(decision.approvedLimit) || 0
      const terms = Number(decision.approvedTermsDays) || 0
      if (!window.confirm(`${ACTION_LABELS[action]}: ${fmtKes(limit)} on ${terms} days${decision.conditions ? `\nConditions: ${decision.conditions}` : ''}?`)) return
    } else if (action === 'withdraw' && !window.confirm('Withdraw this application?')) return
    await run(ACTION_LABELS[action], () => call(`/api/credit-applications/${detail.id}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note, approvedLimit: Number(decision.approvedLimit) || 0, approvedTermsDays: Number(decision.approvedTermsDays) || 0, conditions: decision.conditions || null }),
    }))
  }

  const sendLink = async (opts: { email?: string; renew?: boolean }) => {
    if (!detail) return
    setBusy(true)
    try {
      const body = await call(`/api/credit-applications/${detail.id}/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
      })
      if (body?.application) adopt(body.application)
      if (body?.emailed) showToast(`Link emailed to ${body.emailed}`, 'success')
      else {
        try { await navigator.clipboard.writeText(body.url); showToast('Client link copied', 'success') } catch { showToast('Client link ready', 'success') }
      }
      onChanged?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the link', 'error')
    } finally {
      setBusy(false)
    }
  }

  const upload = (kind: string, file: File | undefined) => {
    if (!detail || !file) return
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    void run(`${file.name} uploaded`, () => call(`/api/credit-applications/${detail.id}/documents`, { method: 'POST', body: fd }))
  }
  const reviewDoc = (doc: Doc, patch: Json, label: string) => detail && run(label, () => call(`/api/credit-applications/${detail.id}/documents/${doc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }))
  const removeDoc = (doc: Doc) => {
    if (!detail || !window.confirm(`Remove ${doc.name} from the application?`)) return
    void run('Document removed', () => call(`/api/credit-applications/${detail.id}/documents/${doc.id}`, { method: 'DELETE' }))
  }

  const actions = useMemo(() => {
    if (!detail) return [] as CreditAction[]
    return (Object.keys(TRANSITIONS) as CreditAction[])
      .filter(a => (TRANSITIONS[a].from as string[]).includes(detail.status) && ACTION_ROLES[a].includes(r))
      .filter(a => {
        if (a === 'approve') return r === 'director' || (detail.approval?.level === 'finance_officer' && detail.requestedById !== userId)
        if (a === 'recommend') return r !== 'director'
        return true
      })
  }, [detail, r, userId])

  if (apps === null) return <p className="p-4 text-xs text-text-3">Loading credit applications…</p>

  const standing = apps.find(a => a.status === 'approved' || a.status === 'suspended')
  const hasOpen = apps.some(a => !DECIDED_STATUSES.includes(a.status))

  const startSection = !hasOpen && (
        <section className={sectionCls}>
          <h4 className="text-sm font-extrabold text-text-1">{standing ? 'Apply for a new limit' : 'Start a credit application'}</h4>
          <p className="mt-1 text-xs text-text-3">
            Corporate customers pay on receipt until credit is approved. Credit is offered after at least {MIN_PAID_TRANSACTIONS} paid
            transactions (payment policy); Finance approves up to {fmtKes(FINANCE_APPROVAL_LIMIT)}, a director above that.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label><span className={labelCls}>Requested credit limit (KES)</span><input className={inputCls} inputMode="decimal" value={newLimit} onChange={e => setNewLimit(e.target.value.replace(/[^\d.]/g, ''))} /></label>
            <label><span className={labelCls}>Requested terms (days)</span><input className={inputCls} inputMode="numeric" value={newTerms} onChange={e => setNewTerms(e.target.value.replace(/\D/g, ''))} /></label>
            <button type="button" className="btn-primary text-xs" disabled={busy || !(Number(newLimit) > 0)} onClick={() => void start()}>Start application</button>
          </div>
          <p className="mt-3 text-[11px] text-text-3">
            Blank forms to send the client:{' '}
            <a className="contacts-inline-link" href="/credit-forms/deed-credit-application-form.pdf" target="_blank" rel="noreferrer">credit application form</a>{' · '}
            <a className="contacts-inline-link" href="/credit-forms/deed-payment-policy-acceptance-form.pdf" target="_blank" rel="noreferrer">payment policy acceptance form</a>
          </p>
        </section>
  )

  return (
    <div className="space-y-4">
      {apps.length === 0 && startSection}

      {/* Applications */}
      {apps.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {apps.map(a => (
            <button key={a.id} type="button" onClick={() => setSelectedId(a.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${a.id === selectedId ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-border-lt text-text-2'}`}>
              {a.ref} · {STATUS_LABELS[a.status]}
            </button>
          ))}
        </div>
      )}

      {detail && (
        <>
          <section className={sectionCls}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-sm font-extrabold text-text-1">{detail.ref} · {clientName ?? detail.client?.name}</h4>
                <p className="mt-1 text-xs text-text-3">Requested by {detail.requestedBy ?? '—'} on {fmtDate(detail.createdAt)}</p>
              </div>
              <Badge status={detail.status} label={STATUS_LABELS[detail.status]} />
            </div>
            {STEPS.includes(detail.status) && <div className="mt-3 overflow-x-auto"><StatusStepper steps={STEPS} current={detail.status} labels={STATUS_LABELS} /></div>}
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-text-3">Requested</dt>
                <dd className="font-bold text-text-1">{fmtKes(detail.requestedLimit)} · {detail.requestedTermsDays} days</dd>
                {open && (
                  <button type="button" className="contacts-inline-link text-[11px]" onClick={() => {
                    const l = window.prompt('Requested credit limit (KES)', String(detail.requestedLimit))
                    if (l == null) return
                    const t = window.prompt('Requested terms (days)', String(detail.requestedTermsDays))
                    if (t == null) return
                    void saveRequested(Number(l) || 0, Number(t) || 0)
                  }}>Change</button>
                )}
              </div>
              <div><dt className="text-text-3">Recommended</dt><dd className="font-bold text-text-1">{detail.recommendedLimit != null ? `${fmtKes(detail.recommendedLimit)} · ${detail.recommendedTermsDays ?? '—'} days` : '—'}{detail.recommendedBy ? ` (${detail.recommendedBy})` : ''}</dd></div>
              <div><dt className="text-text-3">Approved</dt><dd className="font-bold text-text-1">{detail.approvedLimit != null && detail.status !== 'declined' ? `${fmtKes(detail.approvedLimit)} · ${detail.approvedTermsDays} days` : '—'}{detail.decidedBy ? ` (${detail.decidedBy}, ${fmtDate(detail.decidedAt ?? "")})` : ''}</dd></div>
            </dl>
            {detail.reviewDue && <p className="mt-2 text-xs text-text-3">Review due {fmtDate(detail.reviewDue)}</p>}
            {detail.conditions && <p className="mt-2 text-xs text-text-2"><b>Conditions:</b> {detail.conditions}</p>}
            {detail.decisionNote && <p className="mt-1 text-xs text-text-2"><b>Decision note:</b> {detail.decisionNote}</p>}
          </section>

          {/* Client link */}
          {['draft', 'sent', 'info_requested'].includes(detail.status) && (
            <section className={sectionCls}>
              <h4 className="text-sm font-extrabold text-text-1">Client link</h4>
              <p className="mt-1 text-xs text-text-3">
                The client fills in the application and uploads the documents themselves through a secure link (valid 30 days). Emailing it attaches the two blank forms for signing.
              </p>
              {detail.portalLink && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[11px]">
                  <span className="min-w-0 flex-1 break-all font-mono text-text-2">{detail.portalLink.url}</span>
                  <span className={detail.portalLink.expired ? 'font-semibold text-red-700' : 'text-text-3'}>{detail.portalLink.expired ? 'expired' : `until ${fmtDate(detail.portalLink.expiresAt ?? '')}`}</span>
                  {!detail.portalLink.expired && <button type="button" className="contacts-inline-link" onClick={() => { void navigator.clipboard?.writeText(detail.portalLink!.url).then(() => showToast('Client link copied', 'success')).catch(() => null) }}>Copy</button>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => {
                  const email = window.prompt("Client's email address (the financial controller or the person completing the form)", detail.client?.email ?? '')
                  if (email?.trim()) void sendLink({ email: email.trim(), renew: Boolean(detail.portalLink?.expired) })
                }}>Email link to client</button>
                <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void sendLink({ renew: Boolean(detail.portalLink?.expired) })}>
                  {detail.portalLink && !detail.portalLink.expired ? 'Copy link' : 'Create link'}
                </button>
                {detail.portalLink && !detail.portalLink.expired && (
                  <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => {
                    if (window.confirm('Make a new link? The current one stops working.')) void sendLink({ renew: true })
                  }}>New link</button>
                )}
              </div>
            </section>
          )}

          {/* Documents */}
          <section className={sectionCls}>
            <h4 className="text-sm font-extrabold text-text-1">Documents</h4>
            <p className="mt-1 text-xs text-text-3">Upload what the client sends back; Finance verifies each one. PDF, image, Word or Excel, up to 10 MB.</p>
            <div className="mt-3 divide-y divide-border-lt">
              {(detail.checklist ?? []).map(item => {
                const docs = detail.documents.filter(d => d.kind === item.kind)
                const tone = item.state === 'verified' ? 'paid' : item.state === 'missing' ? (item.required ? 'cancelled' : 'draft') : item.state === 'received' ? 'pending_approval' : 'rejected'
                return (
                  <div key={item.kind} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-1">{item.label}{item.required ? '' : ' (optional)'}</p>
                        {item.hint && <p className="text-[11px] text-text-3">{item.hint}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge status={tone} label={item.state === 'missing' ? 'Missing' : item.state.charAt(0).toUpperCase() + item.state.slice(1)} size="xs" />
                        {(open || detail.status === 'approved') && (
                          <label className="btn-secondary cursor-pointer text-[11px]">
                            Upload
                            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" disabled={busy}
                              onChange={e => { upload(item.kind, e.target.files?.[0]); e.target.value = '' }} />
                          </label>
                        )}
                      </div>
                    </div>
                    {docs.map(doc => (
                      <div key={doc.id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[11px]">
                        <a className="contacts-inline-link font-semibold" href={`/api/credit-applications/${detail.id}/documents?file=${doc.id}`} target="_blank" rel="noreferrer">{doc.name}</a>
                        <span className="text-text-3">{doc.uploadedVia === 'client' ? 'from client' : doc.uploadedBy ?? ''} · {fmtDate(doc.createdAt)}</span>
                        <Badge status={doc.status === 'verified' ? 'paid' : doc.status === 'rejected' ? 'rejected' : 'pending_approval'} label={doc.status} size="xs" />
                        {item.expires && (
                          <label className="flex items-center gap-1 text-text-3">expires
                            <input type="date" className="rounded border border-border-lt bg-card px-1 py-0.5 text-[11px]" value={doc.expiresOn ?? ''} disabled={!isFinance || busy}
                              onChange={e => void reviewDoc(doc, { expiresOn: e.target.value || null }, 'Expiry date saved')} />
                          </label>
                        )}
                        {isFinance && doc.status !== 'verified' && <button type="button" className="contacts-inline-link" disabled={busy} onClick={() => void reviewDoc(doc, { status: 'verified' }, 'Document verified')}>Verify</button>}
                        {isFinance && doc.status !== 'rejected' && <button type="button" className="contacts-inline-link" disabled={busy} onClick={() => {
                          const note = window.prompt('Why is this document rejected?')
                          if (note?.trim()) void reviewDoc(doc, { status: 'rejected', note }, 'Document rejected')
                        }}>Reject</button>}
                        {open && <button type="button" className="contacts-inline-link text-red-700" disabled={busy} onClick={() => removeDoc(doc)}>Remove</button>}
                        {doc.note && <span className="w-full text-text-3">Note: {doc.note}</span>}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Application form */}
          <section className={sectionCls}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-extrabold text-text-1">Credit application form</h4>
              {editableForm && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-[11px]" onClick={prefill}>Fill from contact</button>
                  <button type="button" className="btn-primary text-[11px]" disabled={busy || !formDirty} onClick={() => void saveForm()}>Save form</button>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-text-3">As on the Deed Technologies Credit Application Form. Type it in from the client's copy.</p>
            <details className="mt-3" open={editableForm}>
              <summary className="cursor-pointer text-xs font-bold text-text-2">Business details</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {BUSINESS_FIELDS.map(def => <TextField key={def.key} def={def} value={form[def.key]} disabled={!editableForm} onChange={v => setField(def.key, v)} />)}
                <label>
                  <span className={labelCls}>Type of business</span>
                  <select className={inputCls} value={form.businessType ?? ''} disabled={!editableForm} onChange={e => setField('businessType', e.target.value)}>
                    <option value="">—</option>
                    {BUSINESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            </details>
            {GROUPS.map(g => {
              const rows = groupRows(g)
              return (
                <details key={g.key} className="mt-3">
                  <summary className="cursor-pointer text-xs font-bold text-text-2">{g.title}</summary>
                  {g.note && <p className="mt-1 text-[11px] text-text-3">{g.note}</p>}
                  {rows.map((row, i) => (
                    <div key={i} className="mt-2 rounded-xl border border-border-lt p-3">
                      <p className="mb-2 text-[11px] font-bold text-text-3">{i + 1}.</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {g.fields.map(def => <TextField key={def.key} def={def} value={row[def.key]} disabled={!editableForm} onChange={v => setGroup(g, i, def.key, v)} />)}
                      </div>
                    </div>
                  ))}
                  {editableForm && rows.length < g.max && (
                    <button type="button" className="contacts-inline-link mt-2 text-[11px]" onClick={() => setField(g.key, [...rows, {}])}>Add another</button>
                  )}
                </details>
              )
            })}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold text-text-2">Business stakeholders</summary>
              <p className="mt-1 text-[11px] text-text-3">Statements go to the financial controller's email unless otherwise indicated.</p>
              {STAKEHOLDERS.map(([key, label]) => {
                const v = (form.stakeholders?.[key] ?? {}) as Json
                const set = (k: string, val: string) => setField('stakeholders', { ...(form.stakeholders ?? {}), [key]: { ...v, [k]: val } })
                return (
                  <div key={key} className="mt-2 grid gap-3 sm:grid-cols-3">
                    <TextField def={{ key: 'name', label: `${label} — name` }} value={v.name} disabled={!editableForm} onChange={val => set('name', val)} />
                    <TextField def={{ key: 'email', label: 'Email', type: 'email' }} value={v.email} disabled={!editableForm} onChange={val => set('email', val)} />
                    <TextField def={{ key: 'phone', label: 'Cellphone' }} value={v.phone} disabled={!editableForm} onChange={val => set('phone', val)} />
                  </div>
                )
              })}
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold text-text-2">Payment policy acceptance</summary>
              <p className="mt-1 text-[11px] text-text-3">Payment on receipt for initial transactions; credit evaluated after at least three successful transactions; late payments may incur fees.</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {PAYMENT_METHODS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={Boolean(form.paymentMethods?.includes?.(key))} disabled={!editableForm}
                      onChange={e => setField('paymentMethods', e.target.checked ? [...(form.paymentMethods ?? []), key] : (form.paymentMethods ?? []).filter((m: string) => m !== key))} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <TextField def={{ key: 'policyAcceptedOn', label: 'Date of policy acceptance', type: 'date' }} value={form.policyAcceptedOn} disabled={!editableForm} onChange={v => setField('policyAcceptedOn', v)} />
                <TextField def={{ key: 'accountManager', label: 'Account manager' }} value={form.accountManager} disabled={!editableForm} onChange={v => setField('accountManager', v)} />
              </div>
            </details>
          </section>

          {/* Credit check */}
          {(isFinance || detail.riskClass) && (
            <section className={sectionCls}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-extrabold text-text-1">Credit check</h4>
                {isFinance && open && <button type="button" className="btn-primary text-[11px]" disabled={busy || !checkDirty} onClick={() => void saveCheck()}>Save credit check</button>}
              </div>
              <p className={`mt-1 text-xs ${(detail.paidTransactions ?? 0) >= MIN_PAID_TRANSACTIONS ? 'text-emerald-700' : 'text-amber-800'}`}>
                Payment history: {detail.paidTransactions ?? 0} fully paid invoice{detail.paidTransactions === 1 ? '' : 's'}
                {(detail.paidTransactions ?? 0) < MIN_PAID_TRANSACTIONS ? ` — the payment policy asks for ${MIN_PAID_TRANSACTIONS}; only a director can approve credit now.` : ' — meets the payment policy.'}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {CHECK_FLAGS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-text-2">
                    <input type="checkbox" checked={Boolean(assessment[key])} disabled={!isFinance || !open}
                      onChange={e => { setAssessment(a => ({ ...a, [key]: e.target.checked })); setCheckDirty(true) }} />
                    {label}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-xs text-text-2">
                  Trade references contacted
                  <input className="w-16 rounded border border-border-lt bg-card px-1.5 py-0.5 text-xs" inputMode="numeric" value={assessment.tradeReferencesChecked ?? ''} disabled={!isFinance || !open}
                    onChange={e => { setAssessment(a => ({ ...a, tradeReferencesChecked: Number(e.target.value.replace(/\D/g, '')) || 0 })); setCheckDirty(true) }} />
                </label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CHECK_NOTES.map(([key, label]) => (
                  <TextField key={key} def={{ key, label, type: key === 'debtToEquity' ? 'text' : 'textarea' }} value={assessment[key]} disabled={!isFinance || !open}
                    onChange={v => { setAssessment(a => ({ ...a, [key]: v })); setCheckDirty(true) }} />
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label>
                  <span className={labelCls}>Risk classification</span>
                  <select className={inputCls} value={decision.riskClass ?? ''} disabled={!isFinance || !open} onChange={e => { setDecision(d => ({ ...d, riskClass: e.target.value })); setCheckDirty(true) }}>
                    <option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </label>
                <label><span className={labelCls}>Recommended limit (KES)</span><input className={inputCls} inputMode="decimal" value={decision.recommendedLimit ?? ''} disabled={!isFinance || !open}
                  onChange={e => { const v = e.target.value.replace(/[^\d.]/g, ''); setDecision(d => ({ ...d, recommendedLimit: v, approvedLimit: v })); setCheckDirty(true) }} /></label>
                <label><span className={labelCls}>Recommended terms (days)</span><input className={inputCls} inputMode="numeric" value={decision.recommendedTermsDays ?? ''} disabled={!isFinance || !open}
                  onChange={e => { const v = e.target.value.replace(/\D/g, ''); setDecision(d => ({ ...d, recommendedTermsDays: v, approvedTermsDays: v })); setCheckDirty(true) }} /></label>
                <label className="sm:col-span-3"><span className={labelCls}>Conditions (e.g. security deposit, director guarantee, lower limit for the first months)</span>
                  <textarea className={inputCls} rows={2} value={decision.conditions ?? ''} disabled={!isFinance || !open} onChange={e => { setDecision(d => ({ ...d, conditions: e.target.value })); setCheckDirty(true) }} /></label>
              </div>
            </section>
          )}

          {/* Decision */}
          {actions.length > 0 && (
            <section className={sectionCls}>
              <h4 className="text-sm font-extrabold text-text-1">Next step</h4>
              {(actions.includes('approve') || actions.includes('recommend')) && detail.approval && (
                <div className="mt-2 text-xs">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className={labelCls}>Limit to {actions.includes('approve') ? 'approve' : 'recommend'} (KES)</span><input className={inputCls} inputMode="decimal" value={decision.approvedLimit ?? ''} onChange={e => setDecision(d => ({ ...d, approvedLimit: e.target.value.replace(/[^\d.]/g, '') }))} /></label>
                    <label><span className={labelCls}>Payment terms (days)</span><input className={inputCls} inputMode="numeric" value={decision.approvedTermsDays ?? ''} onChange={e => setDecision(d => ({ ...d, approvedTermsDays: e.target.value.replace(/\D/g, '') }))} /></label>
                  </div>
                  <p className="mt-2 text-text-3">
                    {Number(decision.approvedLimit) > FINANCE_APPROVAL_LIMIT || detail.approval.policyException ? 'A director approves this.' : 'Finance can approve this.'}
                    {' '}The person who requested the credit cannot approve it.
                  </p>
                  {detail.approval.blockers.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800">
                      {detail.approval.blockers.map(b => <li key={b}>{b}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {actions.map(a => (
                  <button key={a} type="button" disabled={busy}
                    className={a === 'approve' || a === 'recommend' || a === 'submit' || a === 'start_review' ? 'btn-primary text-[11px]' : 'btn-secondary text-[11px]'}
                    onClick={() => void act(a)}>
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* History */}
          <section className={sectionCls}>
            <h4 className="text-sm font-extrabold text-text-1">History</h4>
            <ol className="mt-2 space-y-1.5 text-[11px] text-text-2">
              {[...(detail.events ?? [])].reverse().map((e, i) => (
                <li key={i}><span className="text-text-3">{fmtDateTime(e.at)}</span> · <b>{e.byName ?? 'Client'}</b> · {e.action.replace(/_/g, ' ')}{e.note ? ` — ${e.note}` : ''}</li>
              ))}
            </ol>
          </section>
        </>
      )}

      {apps.length > 0 && startSection}
    </div>
  )
}
