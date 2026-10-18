/**
 * Client-safe document number helpers.
 * Server routes should call getNextDocNumber from lib/doc-ref-counter directly.
 */

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
  | 'buyback'
  | 'exchange'
  | 'outsource'
  | 'outsource_payment'
  | 'rider_pay'
  | 'expense'
  | 'opportunity'
  | 'contract'
  | 'kilimall_order'
  | 'kilimall_dispatch'
  | 'kilimall_settlement'

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
  BBK: 'buyback',
  EXC: 'exchange',
  OUT: 'outsource',
  OPAY: 'outsource_payment',
  RWP: 'rider_pay',
  EXP: 'expense',
  OPP: 'opportunity',
  CTR: 'contract',
  KO: 'kilimall_order',
  KD: 'kilimall_dispatch',
  KS: 'kilimall_settlement',
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

/**
 * Used only when the server could not hand out a number. It used to count
 * up from this browser's own copy of the sequence, so two browsers (or one
 * after the server had moved on) issued the same number twice (the likely
 * reason DN/2026/0082–0088 each ended up on two delivery notes). It now returns a
 * number that cannot clash with the server's sequence: the prefix and year,
 * then "L" and a time-based code (e.g. DN/2026/L5K2J9QX).
 */
export function allocateDocNumberSync(prefix: string): string {
  const year = new Date().getFullYear()
  const stamp = Date.now().toString(36).toUpperCase()
  const salt = Math.floor(Math.random() * 36 * 36).toString(36).toUpperCase().padStart(2, '0')
  return `${prefix}/${year}/L${stamp}${salt}`
}
