'use client'

import { useEffect, useState } from 'react'
import { fmtDate } from '@/lib/store'
import { fetchDocumentWarranties, type LinkedWarranty } from '@/lib/warranty/client'
import { EWarrantyActions } from './EWarrantyActions'

/**
 * The warranties a sale document carries, with Open / PDF / Copy / WhatsApp,
 * so staff never leave the invoice to give the customer their warranty.
 * Shows nothing when the document has none.
 */
export function DocumentWarranties({ invoiceId, saleOrderId, className }: { invoiceId?: string; saleOrderId?: string; className?: string }) {
  const [list, setList] = useState<LinkedWarranty[]>([])
  useEffect(() => {
    let cancelled = false
    void fetchDocumentWarranties({ invoiceId, saleOrderId }).then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [invoiceId, saleOrderId])
  if (!list.length) return null
  return (
    <article className={className ?? 'invoice-detail__info-card'}>
      <header className="invoice-detail__info-head">
        <h3>Warrant{list.length === 1 ? 'y' : 'ies'}</h3>
      </header>
      <ul className="flex flex-col gap-3 text-[12px]">
        {list.map(w => (
          <li key={w.id} className="flex flex-col gap-1.5">
            <div>
              <p className="font-mono font-semibold" style={{ color: 'var(--navy)' }}>{w.ref} <span className="font-sans font-normal text-t3">· until {fmtDate(w.endDate)}</span></p>
              <p className="text-t2 truncate" title={w.productName}>{w.productName}</p>
              <p className="font-mono text-[11px] text-t3">SN {w.serialNumber}</p>
            </div>
            <EWarrantyActions warranty={w} compact />
          </li>
        ))}
      </ul>
    </article>
  )
}
