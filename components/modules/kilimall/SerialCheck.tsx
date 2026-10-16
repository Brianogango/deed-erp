'use client'

import { useState } from 'react'

interface Item {
  dispatchRef: string
  orderRef: string
  productName: string
  serialNumber: string
  found: string
  location: string
  action: 'mark_sold' | 'serial_missing'
}

/** Every dispatched Kilimall serial must be sold. Lists the ones that are not and fixes them on request. */
export function KilimallSerialCheck({ showToast, onDone }: { showToast: (msg: string, type?: 'success' | 'error') => void; onDone?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/kilimall/reconcile-serials')
      const data = await res.json().catch(() => null)
      if (!res.ok) { showToast(data?.error || 'Could not check dispatched serials', 'error'); return }
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch { showToast('Could not check dispatched serials', 'error') } finally { setBusy(false) }
  }

  const fix = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/kilimall/reconcile-serials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { showToast(data?.error || 'Could not update the serials', 'error'); return }
      showToast(`${data?.applied ?? 0} serial(s) marked sold and taken out of stock`)
      setItems(null)
      onDone?.()
    } catch { showToast('Could not update the serials', 'error') } finally { setBusy(false) }
  }

  const fixable = (items ?? []).filter(i => i.action === 'mark_sold')
  const missing = (items ?? []).filter(i => i.action === 'serial_missing')

  return (
    <div className="card px-4 py-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[12px] font-semibold">Dispatched serials</p>
          <p className="text-[11px] text-t3">Every dispatched serial should be marked sold so it leaves inventory.</p>
        </div>
        <button className="btn-outline text-[12px]" onClick={check} disabled={busy}>{busy && items === null ? 'Checking…' : 'Check now'}</button>
      </div>
      {items !== null && (
        <div className="mt-3">
          {items.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--success)' }}>All dispatched serials are marked sold.</p>
          ) : (
            <>
              {fixable.length > 0 && (
                <>
                  <p className="text-[12px] mb-2">{fixable.length} dispatched serial{fixable.length === 1 ? ' is' : 's are'} not marked sold:</p>
                  <ul className="text-[11px] mb-3 space-y-1">
                    {fixable.map(i => (
                      <li key={`${i.dispatchRef}-${i.serialNumber}`}>
                        <span className="font-mono">{i.serialNumber}</span> · {i.productName} · {i.orderRef || i.dispatchRef} · now {i.found}
                      </li>
                    ))}
                  </ul>
                  <button className="btn-primary text-[12px]" onClick={fix} disabled={busy}>
                    {busy ? 'Updating…' : `Mark ${fixable.length} as sold`}
                  </button>
                </>
              )}
              {missing.length > 0 && (
                <p className="text-[11px] mt-3 text-t3">
                  {missing.length} dispatch{missing.length === 1 ? ' has' : 'es have'} a serial that is not in the register: {missing.map(i => i.serialNumber || i.dispatchRef).join(', ')}. These need a manual look.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
