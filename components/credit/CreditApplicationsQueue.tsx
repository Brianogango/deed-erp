'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Modal } from '@/components/ui'
import { fmtDate, fmtKes, useApp } from '@/lib/store'
import { normalizeClientRole } from '@/lib/auth/access'
import { STATUS_LABELS } from '@/lib/credit/credit-facility-rules'
import CreditFacilityPanel, { type CreditApplicationView } from './CreditFacilityPanel'

type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void
type ReviewRow = { clientId: string; name: string; creditStatus: string; reviewDue: string | null; creditLimit: number; paymentTermsDays: number; isCompany: boolean; openApplication: { id: string; ref: string } | null }

const FILTERS: Array<[string, string]> = [
  ['open', 'Open'],
  ['reviews', 'Reviews due'],
  ['recommended', 'Awaiting director'],
  ['approved', 'Approved'],
  ['suspended', 'Suspended'],
  ['declined', 'Declined'],
  ['', 'All'],
]

/** Finance → Invoices → Credit applications: every application waiting on someone, newest first. */
export default function CreditApplicationsQueue({ role, userId, showToast }: { role: string | null | undefined; userId?: string | null; showToast: Toast }) {
  const { systemSettings, updateSystemSettings } = useApp()
  const enforced = Boolean(systemSettings.accCreditPayOnReceiptEnforced)
  const isDirector = normalizeClientRole(role) === 'director'
  const toggleEnforced = () => {
    const next = !enforced
    if (!window.confirm(next
      ? 'Turn ON pay on receipt?\n\nCompany customers without approved credit (or with credit suspended / revoked) cannot have a sale order confirmed or invoiced while they owe money, and their invoices fall due on the day. Finance/Director can still override.'
      : 'Turn OFF pay on receipt?\n\nCompany customers without approved credit are treated as before: their contact payment terms apply and owing money does not block new orders (overdue invoices still do).')) return
    updateSystemSettings({ accCreditPayOnReceiptEnforced: next })
    showToast(`Pay on receipt is now ${next ? 'on' : 'off'}`, 'success')
  }
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState<CreditApplicationView[] | null>(null)
  const [openApp, setOpenApp] = useState<CreditApplicationView | null>(null)

  const [reviews, setReviews] = useState<ReviewRow[] | null>(null)

  const load = useCallback(async () => {
    if (filter === 'reviews') {
      try {
        const res = await fetch('/api/credit-applications/reviews', { cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`)
        setReviews(body?.reviews ?? [])
      } catch (err) {
        setReviews([])
        showToast(`Could not load reviews: ${err instanceof Error ? err.message : 'error'}`, 'error')
      }
      return
    }
    try {
      const res = await fetch(`/api/credit-applications${filter ? `?status=${filter}` : ''}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`)
      setRows(body?.applications ?? [])
    } catch (err) {
      setRows([])
      showToast(`Could not load credit applications: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }, [filter, showToast])

  useEffect(() => { void load() }, [load])

  const today = new Date().toISOString().slice(0, 10)

  const startReview = async (r: ReviewRow) => {
    try {
      const res = await fetch('/api/credit-applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: r.clientId, requestedLimit: r.creditLimit, requestedTermsDays: r.paymentTermsDays || 30, note: 'Credit review' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`)
      showToast(`Review started — ${body.application.ref}`, 'success')
      setOpenApp(body.application)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start the review', 'error')
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Credit applications</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Corporate customers applying for credit terms. Finance checks the documents and the client, approves up to KES 100,000 and recommends larger limits to a director.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${filter === id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-border-lt text-text-2'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border-lt bg-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-2">
          <b>Pay on receipt: {enforced ? 'on' : 'off'}.</b>{' '}
          {enforced
            ? 'Company customers without approved credit cannot get a new order or invoice while they owe money; their invoices fall due on the day.'
            : 'Off — company customers without approved credit are not blocked yet. Mark real credit customers as legacy or approve their applications, then turn it on.'}
        </p>
        {isDirector
          ? <button type="button" className={enforced ? 'btn-secondary text-[11px]' : 'btn-primary text-[11px]'} onClick={toggleEnforced}>{enforced ? 'Turn off' : 'Turn on'}</button>
          : <span className="text-[11px] text-text-3">A director switches this.</span>}
      </div>

      {filter === 'reviews' ? (
        reviews === null ? <p className="mt-4 text-xs text-text-3">Loading…</p>
        : reviews.length === 0 ? <p className="mt-4 text-xs text-text-3">No credit is due for review in the next 30 days.</p>
        : (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-xs text-text-3">Customers whose credit is due for review within 30 days. "Legacy" credit was given before applications existed — start an application to collect the documents.</p>
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[11px] text-text-3">
                <tr><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Standing</th><th className="py-2 pr-3 text-right">Limit · terms</th><th className="py-2 pr-3">Review due</th><th className="py-2" /></tr>
              </thead>
              <tbody>
                {reviews.map(r => (
                  <tr key={r.clientId} className="border-t border-border-lt">
                    <td className="py-2 pr-3 font-semibold">{r.name}</td>
                    <td className="py-2 pr-3">{r.creditStatus === 'legacy' ? 'Legacy' : 'Approved'}</td>
                    <td className="py-2 pr-3 text-right">{r.creditLimit ? fmtKes(r.creditLimit) : '—'} · {r.paymentTermsDays}d</td>
                    <td className={`py-2 pr-3 ${r.reviewDue && r.reviewDue < today ? 'font-semibold text-red-700' : ''}`}>{r.reviewDue ? fmtDate(r.reviewDue) : '—'}</td>
                    <td className="py-2 text-right">
                      {r.openApplication
                        ? <button type="button" className="contacts-inline-link" onClick={() => setOpenApp({ id: r.openApplication!.id, clientId: r.clientId, ref: r.openApplication!.ref, client: { name: r.name } } as CreditApplicationView)}>{r.openApplication.ref}</button>
                        : <button type="button" className="btn-secondary text-[11px]" onClick={() => void startReview(r)}>Start review</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows === null ? (
        <p className="mt-4 text-xs text-text-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-xs text-text-3">No credit applications here. Start one from the customer's page (Contacts → customer → Credit).</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[11px] text-text-3">
              <tr>
                <th className="py-2 pr-3">Ref</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Requested</th><th className="py-2 pr-3 text-right">Approved</th>
                <th className="py-2 pr-3">Documents</th><th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const verified = a.documents.filter(d => d.status === 'verified').length
                const reviewOverdue = a.status === 'approved' && a.reviewDue && a.reviewDue < today
                return (
                  <tr key={a.id} className="cursor-pointer border-t border-border-lt hover:bg-muted" onClick={() => setOpenApp(a)}>
                    <td className="py-2 pr-3 font-mono font-semibold">{a.ref}</td>
                    <td className="py-2 pr-3">{a.client?.name ?? '—'}</td>
                    <td className="py-2 pr-3"><Badge status={a.status} label={STATUS_LABELS[a.status]} size="xs" />{reviewOverdue && <span className="ml-1 text-[11px] font-semibold text-amber-800">review due</span>}</td>
                    <td className="py-2 pr-3 text-right">{fmtKes(a.requestedLimit)} · {a.requestedTermsDays}d</td>
                    <td className="py-2 pr-3 text-right">{a.approvedLimit != null && a.status !== 'declined' ? `${fmtKes(a.approvedLimit)} · ${a.approvedTermsDays}d` : '—'}</td>
                    <td className="py-2 pr-3">{verified}/{a.documents.length} verified</td>
                    <td className="py-2">{fmtDate(a.updatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openApp && (
        <Modal title={`${openApp.ref} · ${openApp.client?.name ?? ''}`} subtitle="Credit application" width={980} variant="enterprise" onClose={() => { setOpenApp(null); void load() }}>
          <CreditFacilityPanel clientId={openApp.clientId} initialApplicationId={openApp.id} clientName={openApp.client?.name} role={role} userId={userId} showToast={showToast} />
        </Modal>
      )}
    </div>
  )
}
