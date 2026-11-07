'use client'

import type { DocWarranty } from './e-warranty'

/** A document warranty with its full certificate and check links (this site). */
export type LinkedWarranty = DocWarranty & { url: string; checkUrl: string }

const withLinks = (rows: DocWarranty[]): LinkedWarranty[] =>
  rows.map(w => ({ ...w, url: `${window.location.origin}${w.path}`, checkUrl: `${window.location.origin}${w.path}/check` }))

/** The warranties an invoice / POS sale / sale order carries. Never throws: none on failure. */
export async function fetchDocumentWarranties(q: { invoiceId?: string; posOrderId?: string; saleOrderId?: string }): Promise<LinkedWarranty[]> {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as Array<[string, string]>)
  try {
    const res = await fetch(`/api/warranties/for-document?${params}`, { cache: 'no-store' })
    if (!res.ok) return []
    const out = await res.json()
    return withLinks(Array.isArray(out.warranties) ? out.warranties : [])
  } catch {
    return []
  }
}

/** Issue a POS sale's warranties now (the receipt carries them) and return them. Never throws. */
export async function issuePosWarranties(order: {
  id: string; ref: string; date?: string; customerId?: string; customerName?: string
  lines: Array<{ productId: string; productName?: string; serialId?: string }>
}): Promise<LinkedWarranty[]> {
  if (!order.lines.some(l => l.serialId)) return []
  try {
    const res = await fetch('/api/warranties/issue-for-sale', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'pos', id: order.id, ref: order.ref, date: order.date, customerId: order.customerId, customerName: order.customerName, lines: order.lines }),
    })
    if (!res.ok) return []
    const out = await res.json()
    return withLinks(Array.isArray(out.warranties) ? out.warranties : [])
  } catch {
    return []
  }
}
