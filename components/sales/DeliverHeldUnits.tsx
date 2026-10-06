'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Line = {
  productId: string; productName: string; ordered: number; delivered: number; remaining: number
  pick: Array<{ id: string; serial: string }>
  heldForOtherOrders: Array<{ serial: string; orderRef: string }>
  heldElsewhere: Array<{ serial: string; why: string }>
}
type Preview = { saleOrder: { id: string; ref: string; customerName: string; status: string }; lines: Line[] }

/**
 * Sales → deliver held units (director). Marks an order's held units sold by
 * validating one delivery for them (app/api/sale-orders/deliver-held).
 */
export default function DeliverHeldUnits() {
  const params = useSearchParams()
  const [so, setSo] = useState(params?.get('so') ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = async (ref = so) => {
    if (!ref.trim()) return
    setBusy(true); setMessage(null)
    try {
      const res = await fetch(`/api/sale-orders/deliver-held?so=${encodeURIComponent(ref.trim())}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setPreview(body)
    } catch (err) {
      setPreview(null)
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not load the order' })
    } finally { setBusy(false) }
  }
  useEffect(() => { if (so) void load(so) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = preview?.lines.reduce((s, l) => s + l.pick.length, 0) ?? 0

  const deliver = async () => {
    if (!preview || !total) return
    if (!window.confirm(`Deliver ${total} held unit${total === 1 ? '' : 's'} on ${preview.saleOrder.ref} (${preview.saleOrder.customerName}) and mark them sold?`)) return
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/sale-orders/deliver-held', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ so: preview.saleOrder.ref }) })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setMessage({ tone: 'ok', text: `Delivery ${body.deliveryRef} validated — ${body.delivered} unit(s) marked sold.` })
      await load(preview.saleOrder.ref)
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Delivery failed' })
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-extrabold text-text-1">Deliver held units</h1>
        <p className="mt-1 text-xs text-text-3">For an order that was invoiced but never delivered: its held units go out on one delivery and are marked sold. Units held for another order are never taken.</p>
      </div>
      <div className="flex gap-2">
        <input className="form-input w-56 text-sm" placeholder="SO/2026/0004" value={so} onChange={e => setSo(e.target.value)} aria-label="Sale order number" onKeyDown={e => { if (e.key === 'Enter') void load() }} />
        <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void load()}>Preview</button>
      </div>
      {message && <p role="status" className={`rounded-xl p-3 text-xs font-semibold ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}
      {preview && (
        <div className="rounded-2xl border border-border-lt bg-card p-4">
          <p className="text-sm font-extrabold text-text-1">{preview.saleOrder.ref} · {preview.saleOrder.customerName}</p>
          {preview.lines.map(line => (
            <div key={line.productId} className="mt-3 border-t border-border-lt pt-3 text-xs">
              <p className="font-bold text-text-1">{line.productName}</p>
              <p className="text-text-3">Ordered {line.ordered} · delivered {line.delivered} · still to deliver {line.remaining}</p>
              <p className="mt-1 font-semibold text-emerald-800">Will deliver {line.pick.length}{line.pick.length ? `: ${line.pick.map(p => p.serial).join(', ')}` : ''}</p>
              {line.heldForOtherOrders.length > 0 && <p className="mt-1 text-amber-800">Left alone — held for other orders: {line.heldForOtherOrders.map(h => `${h.serial} (${h.orderRef})`).join(', ')}</p>}
              {line.heldElsewhere.length > 0 && <p className="mt-1 text-amber-800">Left alone: {line.heldElsewhere.map(h => `${h.serial} (${h.why})`).join(', ')}</p>}
            </div>
          ))}
          <button type="button" className="btn-primary mt-4 text-xs" disabled={busy || total === 0} onClick={() => void deliver()}>
            {busy ? 'Working…' : total ? `Deliver ${total} and mark sold` : 'Nothing to deliver'}
          </button>
        </div>
      )}
    </div>
  )
}
