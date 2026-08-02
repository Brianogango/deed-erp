'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { PortalPageSkeleton } from '@/components/ui'

type PortalOrder = {
  id: string
  ref: string
  status: string
  customerName: string
  date: string
  deliveryDate?: string
  subtotal: number
  taxTotal: number
  total: number
  notes?: string
  lines: Array<{ productName?: string; description?: string; qty?: number; subtotal?: number }>
}

function fmt(n: number) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`
}

export default function CustomerOrderPortal() {
  return (
    <Suspense fallback={<PortalPageSkeleton label="Loading order…" />}>
      <CustomerOrderPortalContent />
    </Suspense>
  )
}

function CustomerOrderPortalContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const token = searchParams.get('token') ?? ''
  const [order, setOrder] = useState<PortalOrder | null>(null)
  const [deliveries, setDeliveries] = useState<Array<{ ref?: string; status?: string; date?: string }>>([])
  const [invoices, setInvoices] = useState<Array<{ ref?: string; status?: string; total?: number; amountPaid?: number }>>([])
  const [company, setCompany] = useState<{ name?: string; phone?: string; email?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`/api/portal/orders/${id}?token=${encodeURIComponent(token)}`)
        if (!res.ok) throw new Error('not found')
        const data = await res.json()
        setOrder(data.order)
        setDeliveries(data.deliveries || [])
        setInvoices(data.invoices || [])
        setCompany(data.company || {})
      } catch {
        setError('This order link is invalid or has expired. Please contact us for a new link.')
      } finally {
        setLoading(false)
      }
    })()
  }, [id, token])

  if (loading) return <PortalPageSkeleton label="Loading order…" />
  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <p className="text-sm text-slate-600 max-w-md text-center">{error || 'Order not found.'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-[#1B2762] text-white px-6 py-8">
        <p className="text-xs uppercase tracking-[0.2em] opacity-80">{company.name || 'Deed Technologies'}</p>
        <h1 className="text-2xl font-semibold mt-2">Order {order.ref}</h1>
        <p className="text-sm opacity-90 mt-1">{order.customerName}</p>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs">Status</p><p className="font-semibold capitalize">{String(order.status).replace(/_/g, ' ')}</p></div>
          <div><p className="text-slate-500 text-xs">Order date</p><p className="font-semibold">{order.date || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Delivery</p><p className="font-semibold">{order.deliveryDate || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Total</p><p className="font-semibold">{fmt(order.total)}</p></div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(order.lines || []).map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3">{l.productName || l.description || 'Line'}</td>
                  <td className="px-4 py-3 text-right">{l.qty ?? 1}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.subtotal) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {deliveries.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold mb-3">Deliveries</h2>
            <ul className="space-y-2 text-sm">
              {deliveries.map((d, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{d.ref || 'Delivery'}</span>
                  <span className="capitalize text-slate-600">{String(d.status || '').replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {invoices.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold mb-3">Invoices</h2>
            <ul className="space-y-2 text-sm">
              {invoices.map((inv, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{inv.ref}</span>
                  <span className="font-mono">{fmt(Number(inv.total) || 0)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
