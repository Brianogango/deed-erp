'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { PortalPageSkeleton } from '@/components/ui'

type PortalInvoice = {
  id: string
  ref: string
  status: string
  partnerName: string
  date: string
  dueDate: string
  subtotal: number
  taxTotal: number
  total: number
  amountPaid: number
  notes?: string
  currencyCode?: string
  lines: Array<{ description?: string; qty?: number; unitPrice?: number; subtotal?: number }>
}

function fmt(n: number) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`
}

export default function CustomerInvoicePortal() {
  return (
    <Suspense fallback={<PortalPageSkeleton label="Loading invoice…" />}>
      <CustomerInvoicePortalContent />
    </Suspense>
  )
}

function CustomerInvoicePortalContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const token = searchParams.get('token') ?? ''
  const [invoice, setInvoice] = useState<PortalInvoice | null>(null)
  const [company, setCompany] = useState<{ name?: string; phone?: string; email?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`/api/portal/invoices/${id}?token=${encodeURIComponent(token)}`)
        if (!res.ok) throw new Error('not found')
        const data = await res.json()
        setInvoice(data.invoice)
        setCompany(data.company || {})
      } catch {
        setError('This invoice link is invalid or has expired. Please contact us for a new link.')
      } finally {
        setLoading(false)
      }
    })()
  }, [id, token])

  if (loading) return <PortalPageSkeleton label="Loading invoice…" />
  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <p className="text-sm text-slate-600 max-w-md text-center">{error || 'Invoice not found.'}</p>
      </div>
    )
  }

  const balance = Math.max(0, (invoice.total || 0) - (invoice.amountPaid || 0))

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-[#1B2762] text-white px-6 py-8">
        <p className="text-xs uppercase tracking-[0.2em] opacity-80">{company.name || 'Deed Technologies'}</p>
        <h1 className="text-2xl font-semibold mt-2">Invoice {invoice.ref}</h1>
        <p className="text-sm opacity-90 mt-1">{invoice.partnerName}</p>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs">Status</p><p className="font-semibold capitalize">{invoice.status}</p></div>
          <div><p className="text-slate-500 text-xs">Due</p><p className="font-semibold">{invoice.dueDate || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Total</p><p className="font-semibold">{fmt(invoice.total)}</p></div>
          <div><p className="text-slate-500 text-xs">Balance due</p><p className="font-semibold text-red-600">{fmt(balance)}</p></div>
        </section>
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines || []).map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3">{l.description || 'Line'}</td>
                  <td className="px-4 py-3 text-right">{l.qty ?? 1}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.subtotal) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {(company.phone || company.email) && (
          <p className="text-xs text-slate-500 text-center">
            Questions? {company.phone || ''}{company.phone && company.email ? ' · ' : ''}{company.email || ''}
          </p>
        )}
      </main>
    </div>
  )
}
