import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { cancelCreditAmount } from '@/lib/finance/cancel-credit'

type CreditRow = { ref?: string; sourceInvoiceId?: string; amount?: number; status?: string }

/**
 * Everything already credited on an invoice: its credit notes (not
 * cancelled), plus credits issued against it some other way (a credit note
 * from the sale order) that have no credit-note record. `exceptRef` leaves
 * out the cancel's own credit, which the screen may save before this runs.
 */
export async function alreadyCreditedOnInvoice(invoiceId: string, exceptRef?: string): Promise<number> {
  const notes = await prisma.creditNote.findMany({
    where: { invoiceId, status: { not: 'cancelled' } },
    select: { creditNoteNumber: true, amount: true },
  })
  const noteRefs = new Set(notes.map(n => n.creditNoteNumber))
  const state = await loadAppState(['deed_customerCredits'])
  const credits = (Array.isArray(state.deed_customerCredits) ? state.deed_customerCredits : []) as CreditRow[]
  const other = credits.filter(c =>
    c?.sourceInvoiceId === invoiceId && c.status !== 'cancelled' && c.ref && !noteRefs.has(c.ref) && c.ref !== exceptRef)
  return [...notes.map(n => Number(n.amount)), ...other.map(c => Number(c.amount) || 0)].reduce((s, n) => s + n, 0)
}

export async function cancelCreditForInvoice(invoice: { id: string; amountPaid: unknown; totalAmount: unknown }, exceptRef?: string) {
  const alreadyCredited = await alreadyCreditedOnInvoice(invoice.id, exceptRef)
  return {
    alreadyCredited,
    creditable: cancelCreditAmount({ amountPaid: Number(invoice.amountPaid), total: Number(invoice.totalAmount), alreadyCredited }),
  }
}
