'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Modal } from '@/components/ui'
import { fmtDate, fmtKes } from '@/lib/store'
import { STATUS_LABELS } from '@/lib/credit/credit-facility-rules'
import CreditFacilityPanel, { type CreditApplicationView } from './CreditFacilityPanel'

type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void

const FILTERS: Array<[string, string]> = [
  ['open', 'Open'],
  ['recommended', 'Awaiting director'],
  ['approved', 'Approved'],
  ['suspended', 'Suspended'],
  ['declined', 'Declined'],
  ['', 'All'],
]

/** Finance → Invoices → Credit applications: every application waiting on someone, newest first. */
export default function CreditApplicationsQueue({ role, userId, showToast }: { role: string | null | undefined; userId?: string | null; showToast: Toast }) {
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState<CreditApplicationView[] | null>(null)
  const [openApp, setOpenApp] = useState<CreditApplicationView | null>(null)

  const load = useCallback(async () => {
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

      {rows === null ? (
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
