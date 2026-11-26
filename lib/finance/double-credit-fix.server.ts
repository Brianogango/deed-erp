import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { persistStoreJournalEntry } from '@/lib/accounting/journal-service'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import { CUSTOMER_CREDITS_ACCOUNT } from '@/lib/accounting/liability-accounts'
import { alreadyCreditedOnInvoice } from '@/lib/finance/cancel-credit.server'
import { cancelCreditAmount, cancelReversal } from '@/lib/finance/cancel-credit'

/**
 * Paid invoices cancelled after a credit note, before the fix in
 * lib/finance/cancel-credit: the cancel credited the full payment again, so
 * the part the credit note had given back was credited twice, and the sale
 * and VAT were reversed twice for it. This finds them and takes the extra
 * back: the cancel credit is lowered and a journal puts the sale back
 * (Dr Customer Credits / Cr Sales, Cr Output VAT).
 */

const CANCEL_NOTE = 'Credit note generated from cancelled paid invoice'
const round2 = (n: number) => Math.round(n * 100) / 100

type Credit = {
  id: string; ref: string; customerName?: string; sourceInvoiceId?: string; sourceInvoiceRef?: string
  amount: number; balance: number; status?: string; notes?: string
  doubleCreditFixedAt?: string; [key: string]: unknown
}

export type DoubleCredit = {
  invoiceId: string; invoiceRef: string; customerName: string
  creditId: string; creditRef: string; creditAmount: number; creditBalance: number
  alreadyCredited: number; correctAmount: number; extra: number
  /** False when the extra was already used or refunded: Finance recovers it by hand. */
  fixable: boolean; why?: string
}

async function examine(c: Credit): Promise<DoubleCredit | null> {
  if (!c.sourceInvoiceId || c.doubleCreditFixedAt || !String(c.notes || '').startsWith(CANCEL_NOTE)) return null
  const inv = await prisma.invoice.findUnique({
    where: { id: c.sourceInvoiceId },
    select: { id: true, invoiceNumber: true, amountPaid: true, totalAmount: true },
  })
  if (!inv) return null
  const alreadyCredited = await alreadyCreditedOnInvoice(inv.id, c.ref)
  if (alreadyCredited <= 0) return null
  const correctAmount = cancelCreditAmount({ amountPaid: Number(inv.amountPaid), total: Number(inv.totalAmount), alreadyCredited })
  const extra = round2((Number(c.amount) || 0) - correctAmount)
  if (extra <= 0.009) return null
  const balance = Number(c.balance) || 0
  const fixable = balance + 0.009 >= extra && !['void', 'refunded', 'cancelled'].includes(String(c.status))
  return {
    invoiceId: inv.id, invoiceRef: inv.invoiceNumber, customerName: c.customerName || '',
    creditId: c.id, creditRef: c.ref, creditAmount: Number(c.amount) || 0, creditBalance: balance,
    alreadyCredited: round2(alreadyCredited), correctAmount, extra, fixable,
    ...(fixable ? {} : { why: `Only ${balance.toLocaleString('en-KE')} of the credit is left; the rest was used or refunded` }),
  }
}

export async function findDoubleCredits(): Promise<DoubleCredit[]> {
  const state = await loadAppState(['deed_customerCredits'])
  const credits = (Array.isArray(state.deed_customerCredits) ? state.deed_customerCredits : []) as Credit[]
  const out: DoubleCredit[] = []
  for (const c of credits) {
    const row = await examine(c)
    if (row) out.push(row)
  }
  return out
}

/** Take the extra back on one cancel credit. Safe to repeat: the journal is keyed on the credit. */
export async function fixDoubleCredit(creditId: string, actor: { id: string; name: string }): Promise<DoubleCredit> {
  return withAppStateKeyLock('deed_customerCredits', async () => {
    const state = await loadAppStateForWrite(['deed_customerCredits'])
    const credits = (Array.isArray(state.deed_customerCredits) ? state.deed_customerCredits : []) as Credit[]
    const idx = credits.findIndex(c => c.id === creditId)
    if (idx < 0) throw Object.assign(new Error('Credit not found'), { status: 404 })
    const row = await examine(credits[idx])
    if (!row) throw Object.assign(new Error(`${credits[idx].ref} has no double credit to take back`), { status: 409 })
    if (!row.fixable) throw Object.assign(new Error(`${row.creditRef}: ${row.why}`), { status: 409 })

    const inv = await prisma.invoice.findUnique({ where: { id: row.invoiceId }, select: { totalAmount: true, subtotal: true, taxAmount: true } })
    const r = cancelReversal({ total: Number(inv?.totalAmount), subtotal: Number(inv?.subtotal), tax: Number(inv?.taxAmount), credit: row.extra, receivable: 0 })
    // Journal first; it is keyed on the credit, so a retry after a failed save posts nothing twice.
    await persistStoreJournalEntry({
      ref: `JRN/FIX/${row.creditRef}`.slice(0, 80),
      source: 'manual',
      description: `Double credit taken back: ${row.creditRef} on cancelled ${row.invoiceRef} (already credited ${row.alreadyCredited})`,
      invoiceId: row.invoiceId,
      lines: [
        { account: CUSTOMER_CREDITS_ACCOUNT, description: `Extra credit removed: ${row.customerName}`, debit: row.extra, credit: 0 },
        { account: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, []), description: `Sale of ${row.invoiceRef} reversed twice — put back`, debit: 0, credit: r.revenue },
        ...(r.vat > 0 ? [{ account: labelForRole('output_vat'), description: `VAT on ${row.invoiceRef} reversed twice — put back`, debit: 0, credit: r.vat }] : []),
      ],
    }, { createdById: actor.id, journalCode: 'SAL' })

    const c = credits[idx]
    const balance = round2(row.creditBalance - row.extra)
    credits[idx] = {
      ...c,
      amount: row.correctAmount,
      balance,
      status: balance <= 0 ? 'used' : c.status,
      doubleCreditFixedAt: new Date().toISOString(),
      doubleCreditFixedBy: actor.name,
      doubleCreditRemoved: row.extra,
      notes: `${c.notes || ''}\nDouble credit of ${row.extra} taken back by ${actor.name} (credit notes on ${row.invoiceRef} had already given ${row.alreadyCredited}).`.trim(),
    }
    await saveStoreKeys({ deed_customerCredits: JSON.stringify(credits) })
    await notifyStoreKeysChanged(['deed_customerCredits']).catch(() => {})
    return row
  })
}
