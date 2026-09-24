/**
 * Client-safe document number helpers.
 * Server routes should call getNextDocNumber from lib/doc-ref-counter directly.
 */

import { safeLocalStorageSet } from '@/lib/client-store-cache'

type DocKind =
  | 'quote'
  | 'quotation'
  | 'invoice'
  | 'sale_order'
  | 'client'
  | 'purchase_order'
  | 'delivery_note'
  | 'credit_note'
  | 'vendor_bill'
  | 'receipt'
  | 'payment_receipt'
  | 'pos'
  | 'delivery_job'

const PREFIX_TO_KIND: Record<string, DocKind> = {
  QUO: 'quotation',
  SO: 'sale_order',
  INV: 'invoice',
  CLT: 'client',
  PO: 'purchase_order',
  DN: 'delivery_note',
  CN: 'credit_note',
  BILL: 'vendor_bill',
  REC: 'receipt',
  RCT: 'payment_receipt',
  POS: 'pos',
  DJB: 'delivery_job',
}

export function prefixToKind(prefix: string): DocKind | undefined {
  return PREFIX_TO_KIND[prefix.toUpperCase()]
}

export async function allocateDocNumber(kind: string): Promise<string> {
  const res = await fetch('/api/doc-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.error ?? `Failed to allocate document number (${res.status})`)
  }
  const data = await res.json()
  if (!data?.number || typeof data.number !== 'string') {
    throw new Error('Invalid document number response')
  }
  return data.number
}

/** Local fallback using the same per-year localStorage high-water mark as docSeq. */
export function allocateDocNumberSync(prefix: string): string {
  const year = new Date().getFullYear()
  const lsKey = `deed_docseq_${prefix}_${year}`
  const stored = typeof window !== 'undefined'
    ? parseInt(localStorage.getItem(lsKey) ?? '0', 10)
    : 0
  const next = (Number.isFinite(stored) ? stored : 0) + 1
  safeLocalStorageSet(lsKey, String(next))
  return `${prefix}/${year}/${String(next).padStart(4, '0')}`
}
