'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  faArrowLeft,
  faFileInvoiceDollar,
  faPenToSquare,
} from '@fortawesome/free-solid-svg-icons'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { Badge } from '@/components/ui'
import { Fa } from '@/components/icons'

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function asDateString(value: unknown) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

function normalizeLine(line: any) {
  const qty = asNumber(line?.qty, 1)
  const unitPrice = asNumber(line?.unitPrice)
  const discount = asNumber(line?.discount ?? line?.discountPct ?? line?.discountPercent)
  const subtotal = line?.subtotal !== undefined || line?.lineSubtotal !== undefined || line?.lineTotal !== undefined
    ? asNumber(line.subtotal ?? line.lineSubtotal ?? line.lineTotal)
    : Math.round(qty * unitPrice * (1 - discount / 100))
  const taxRate = asNumber(line?.taxRate)
  const taxAmount = line?.taxAmount !== undefined || line?.lineTax !== undefined
    ? asNumber(line.taxAmount ?? line.lineTax)
    : Math.round(subtotal * taxRate / 100)

  return {
    id: String(line?.id ?? `${line?.productId ?? 'line'}-${line?.description ?? ''}`),
    description: String(line?.description ?? line?.productName ?? 'Item'),
    qty,
    unitPrice,
    discount,
    taxRate,
    subtotal,
    taxAmount,
    total: asNumber(line?.lineTotal, subtotal + taxAmount),
  }
}

function normalizeQuote(raw: any, source: 'sale-order' | 'quote') {
  const rawLines = Array.isArray(raw?.lines)
    ? raw.lines
    : Array.isArray(raw?.items)
      ? raw.items
      : []
  const lines = rawLines.map(normalizeLine)
  const subtotal = raw?.subtotal !== undefined
    ? asNumber(raw.subtotal)
    : lines.reduce((sum: number, line: ReturnType<typeof normalizeLine>) => sum + line.subtotal, 0)
  const taxTotal = raw?.taxTotal !== undefined || raw?.taxAmount !== undefined
    ? asNumber(raw.taxTotal ?? raw.taxAmount)
    : lines.reduce((sum: number, line: ReturnType<typeof normalizeLine>) => sum + line.taxAmount, 0)
  const total = raw?.total !== undefined || raw?.totalAmount !== undefined
    ? asNumber(raw.total ?? raw.totalAmount)
    : subtotal + taxTotal

  return {
    id: String(raw?.id ?? ''),
    source,
    ref: String(raw?.ref ?? raw?.quoteNumber ?? raw?.orderNumber ?? raw?.id ?? ''),
    status: String(raw?.status ?? 'draft'),
    partnerId: String(raw?.companyId ?? raw?.clientId ?? raw?.customerId ?? raw?.client?.id ?? ''),
    partnerName: String(raw?.companyName ?? raw?.customerName ?? raw?.client?.name ?? 'Customer'),
    subject: String(raw?.subject ?? raw?.opportunityName ?? ''),
    date: asDateString(raw?.quoteDate ?? raw?.issueDate ?? raw?.orderDate ?? raw?.date ?? raw?.createdAt),
    validUntil: asDateString(raw?.validUntil ?? raw?.deliveryDate),
    ownerName: String(raw?.ownerName ?? raw?.createdByName ?? raw?.createdBy?.name ?? 'Sales'),
    notes: raw?.notes ?? raw?.terms ?? '',
    saleOrderId: raw?.saleOrderId ?? (source === 'sale-order' ? raw?.id : undefined),
    invoiceId: raw?.invoiceId,
    lines,
    subtotal,
    taxTotal,
    total,
  }
}

function quoteBadgeStatus(status: string) {
  if (['accepted', 'approved', 'confirmed'].includes(status)) return 'active'
  if (['sent', 'pending_approval', 'quotation', 'draft'].includes(status)) return 'pending'
  if (['rejected', 'cancelled', 'expired'].includes(status)) return 'cancelled'
  return 'warning'
}

export default function SalesQuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { saleOrders, quotes } = useApp()
  const [remoteRecord, setRemoteRecord] = useState<{ source: 'sale-order' | 'quote'; data: any } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const storeSaleOrder = useMemo(() => (saleOrders as any[]).find(order => order.id === id), [saleOrders, id])
  const storeQuote = useMemo(() => (quotes as any[]).find(quote => quote.id === id), [quotes, id])

  useEffect(() => {
    if (!id || storeSaleOrder || storeQuote) return
    let cancelled = false
    setIsLoading(true)

    async function loadQuote() {
      const endpoints: Array<{ source: 'sale-order' | 'quote'; url: string }> = [
        { source: 'sale-order', url: `/api/sale-orders/${encodeURIComponent(id)}` },
        { source: 'quote', url: `/api/quotes/${encodeURIComponent(id)}` },
      ]
      for (const endpoint of endpoints) {
        const res = await fetch(endpoint.url).catch(() => null)
        if (!res?.ok) continue
        const data = await res.json().catch(() => null)
        if (data?.id && !cancelled) {
          setRemoteRecord({ source: endpoint.source, data })
          return
        }
      }
    }

    loadQuote().finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [id, storeSaleOrder, storeQuote])

  const quote = storeSaleOrder
    ? normalizeQuote(storeSaleOrder, 'sale-order')
    : storeQuote
      ? normalizeQuote(storeQuote, 'quote')
      : remoteRecord
        ? normalizeQuote(remoteRecord.data, remoteRecord.source)
        : null

  if (!quote) {
    return (
      <div className="mod-page">
        <div className="mod-header">
          <button className="btn-secondary flex items-center gap-2" onClick={() => router.push('/sales?tab=list')}>
            <Fa icon={faArrowLeft} /> Back to Sales
          </button>
        </div>
        <div className="mod-body p-12 text-center text-[var(--text-3)] text-sm">
          {isLoading ? 'Loading sales quote...' : 'Sales quote not found.'}
        </div>
      </div>
    )
  }

  return (
    <div className="mod-page">
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border border-[var(--border-lt)] hover:bg-[var(--bg-surface)] transition-colors"
            onClick={() => router.push('/sales?tab=list')}
            aria-label="Back to sales"
          >
            <Fa icon={faArrowLeft} />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold text-text-1">Sales Quote {quote.ref}</h1>
            <p className="text-[10px] text-text-3 mt-0.5">{quote.partnerName}</p>
          </div>
        </div>
        <Badge status={quoteBadgeStatus(quote.status) as any} label={quote.status.replace(/_/g, ' ')} />
      </div>

      <div className="mod-body">
        <div className="card m-3 sm:m-4 p-5 max-w-4xl mx-auto flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-1">Customer</p>
              <p className="text-sm font-black text-[var(--text-1)]">{quote.partnerName}</p>
              {quote.subject && <p className="text-xs text-[var(--text-3)] mt-1">{quote.subject}</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-1">Quote Total</p>
              <p className="text-lg font-black text-[var(--text-1)] font-mono">{fmtKes(quote.total)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Quote Date</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{fmtDate(quote.date)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Valid Until</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{quote.validUntil ? fmtDate(quote.validUntil) : '-'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Owner</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{quote.ownerName}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Items</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{quote.lines.length}</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-2">Quote Lines</p>
            <div className="rounded-xl border border-[var(--border-lt)] overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-surface)]">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Unit Price</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Tax</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {quote.lines.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-[var(--text-4)]">No line items recorded.</td>
                    </tr>
                  ) : quote.lines.map((line: ReturnType<typeof normalizeLine>, index: number) => (
                    <tr key={line.id || index} className="hover:bg-[var(--bg-surface)]">
                      <td className="px-3 py-2 text-[var(--text-1)]">{line.description}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-3)]">{line.qty}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">{fmtKes(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-3)]">{line.taxRate}%</td>
                      <td className="px-3 py-2 text-right font-bold text-[var(--text-1)] font-mono">{fmtKes(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--bg-surface)] border-t-2 border-[var(--border-lt)]">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Subtotal</td>
                    <td className="px-3 py-2 text-right font-bold text-[var(--text-1)] font-mono">{fmtKes(quote.subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Tax</td>
                    <td className="px-3 py-2 text-right font-bold text-[var(--text-1)] font-mono">{fmtKes(quote.taxTotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Total</td>
                    <td className="px-3 py-2 text-right font-black text-[var(--text-1)] font-mono">{fmtKes(quote.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {quote.notes && (
            <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4">
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-1">Notes / Terms</p>
              <p className="text-xs text-[var(--text-2)] whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)] flex-wrap">
            {quote.invoiceId && (
              <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={() => router.push(`/finance/invoices/${quote.invoiceId}`)}>
                <Fa icon={faFileInvoiceDollar} /> View Invoice
              </button>
            )}
            {quote.saleOrderId && (
              <button className="btn-primary flex items-center gap-1.5 text-xs" onClick={() => router.push(`/sales?tab=list&order=${quote.saleOrderId}`)}>
                <Fa icon={faPenToSquare} /> Open in Sales
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
