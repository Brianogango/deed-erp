/**
 * Links between the cheque register and invoice / bill payments, so a cheque
 * is typed in once: paying a bill by cheque adds it to the register, and a
 * cheque added to the register can pick the invoice or bill it settles.
 */

import type { ChequeDirection } from '@/lib/cheques/cheque-rules'
import { invoiceDocState } from '@/lib/odoo-sales-flow'

type Doc = {
  id: string
  ref: string
  type: string
  status?: unknown
  partnerName?: string
  total: number
  amountPaid: number
}

/** A customer invoice is paid with a cheque we receive; a vendor bill with one we give. */
export function chequeDirectionForDoc(type: string): ChequeDirection | null {
  if (type === 'customer_invoice') return 'received'
  if (type === 'vendor_bill') return 'given'
  return null
}

export function chequeLinkedType(type: string): 'invoice' | 'bill' | null {
  if (type === 'customer_invoice') return 'invoice'
  if (type === 'vendor_bill') return 'bill'
  return null
}

const posted = (status: unknown) => invoiceDocState(status) === 'posted'
export const docBalance = (doc: Pick<Doc, 'total' | 'amountPaid'>) => Math.max(0, Math.round((Number(doc.total) - Number(doc.amountPaid)) * 100) / 100)

/** Posted invoices (or bills) with money still owing, newest first. */
export function openDocsForCheque<T extends Doc>(docs: T[], direction: ChequeDirection): T[] {
  return docs
    .filter(d => chequeDirectionForDoc(d.type) === direction && posted(d.status) && docBalance(d) > 0)
    .sort((a, b) => String(b.ref).localeCompare(String(a.ref)))
}

/** The document a typed reference names (case and spacing ignored). */
export function findDocByRef<T extends Doc>(docs: T[], ref: string): T | null {
  const key = ref.trim().toLowerCase().replace(/\s+/g, '')
  if (!key) return null
  return docs.find(d => String(d.ref).toLowerCase().replace(/\s+/g, '') === key) ?? null
}

export type ChequeRegisterResult = { ok: true } | { ok: false; duplicate: boolean; error: string }

/** Adds a cheque to the register. A cheque already there is reported, not an error to stop on. */
export async function addChequeToRegister(body: {
  direction: ChequeDirection
  chequeNumber: string
  bankName: string
  partyName: string
  amount: number
  chequeDate: string
  receivedDate?: string
  linkedType?: string | null
  linkedRef?: string | null
  notes?: string
}): Promise<ChequeRegisterResult> {
  try {
    const res = await fetch('/api/cheques', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const data = await res.json().catch(() => ({})) as { error?: string }
    return { ok: false, duplicate: res.status === 409, error: data.error || `Could not add the cheque (HTTP ${res.status})` }
  } catch {
    return { ok: false, duplicate: false, error: 'Could not reach the server to add the cheque' }
  }
}

/**
 * One cheque settling several invoices / bills: how much goes to each.
 * Oldest first, each up to what it still owes, until the cheque is used up.
 * Rounded to the cent.
 */
export function allocateCheque<T extends Pick<Doc, 'id' | 'ref' | 'total' | 'amountPaid'> & { date?: string }>(
  amount: number,
  docs: T[],
): Array<{ doc: T; amount: number }> {
  let left = Math.round(Math.max(0, Number(amount) || 0) * 100)
  const ordered = [...docs].sort((a, b) => String(a.date ?? a.ref).localeCompare(String(b.date ?? b.ref)))
  return ordered.map(doc => {
    const owing = Math.round(docBalance(doc) * 100)
    const take = Math.min(owing, left)
    left -= take
    return { doc, amount: take / 100 }
  })
}

/** The register keeps one short reference: as many refs as fit, then "+N more". */
export function chequeLinkedRefs(refs: string[], max = 80): string {
  const list = refs.filter(Boolean)
  for (let shown = list.length; shown > 0; shown--) {
    const head = list.slice(0, shown).join(', ')
    const text = shown === list.length ? head : `${head} +${list.length - shown} more`
    if (text.length <= max) return text
  }
  return list.length ? `${list[0].slice(0, max - 10)} +${list.length - 1} more` : ''
}
