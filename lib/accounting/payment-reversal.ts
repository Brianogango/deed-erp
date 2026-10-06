/**
 * Reversing a payment registered by mistake (e.g. 42,000 registered when the
 * customer paid 15,000).
 *
 * The payment is not deleted: it is voided, its allocations reversed, its
 * receipt journal reversed (REV/<ref>), and the invoice owes the money again.
 * The right amount is then registered as a new payment.
 *
 * On the invoice screens (deed_invoices) the payment moves from `payments`
 * — which the cashbook, partner ledger and sales screens count as money
 * received — to `voidedPayments`, kept for the record. Pure helpers here;
 * payment-reversal.server.ts does the posting.
 */

type Row = Record<string, any>

export type PaymentReversalInfo = {
  paymentId: string
  amount: number
  reason: string
  reversedAt: string
  reversedBy: string
  /** Used when the invoice's own copy never listed the payment. */
  method?: string
  paidAt?: string
}

/** Methods that move no cash: their reversal belongs with the credit or deposit, not here. */
export function reversalBlockedForMethod(notes: string | null | undefined): string | null {
  const raw = /method:([a-z_]+)/i.exec(String(notes ?? ''))?.[1]?.toLowerCase()
  if (raw === 'customer_credit') return 'This payment applied a customer credit — reverse it from the credit note instead'
  if (raw === 'deposit_apply') return 'This payment applied a deposit — reverse it from the deposit instead'
  return null
}

/** The invoices with the payment moved to `voidedPayments` and amountPaid set to the server's figure. */
export function applyReversalToInvoices(
  invoices: Row[],
  info: PaymentReversalInfo,
  amountPaidByInvoice: Record<string, number>,
): Row[] {
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`
  return invoices.map(inv => {
    if (!(inv?.id in amountPaidByInvoice)) return inv
    const payments = Array.isArray(inv.payments) ? inv.payments : []
    const voided = Array.isArray(inv.voidedPayments) ? inv.voidedPayments : []
    const original = payments.find((p: Row) => String(p?.id) === info.paymentId)
    const already = voided.some((p: Row) => String(p?.id) === info.paymentId)
    return {
      ...inv,
      amountPaid: amountPaidByInvoice[inv.id],
      payments: payments.filter((p: Row) => String(p?.id) !== info.paymentId),
      voidedPayments: already ? voided : [
        ...voided,
        {
          ...(original ?? { id: info.paymentId, amount: info.amount, date: info.paidAt ?? info.reversedAt, method: info.method ?? '', recordedBy: '' }),
          reversedAt: info.reversedAt,
          reversedBy: info.reversedBy,
          reversalReason: info.reason,
        },
      ],
      notes: already ? inv.notes : `${inv.notes || ''}\nPayment of ${fmt(original?.amount ?? info.amount)} reversed by ${info.reversedBy}: ${info.reason}`,
    }
  })
}

/** The screen copy of the receipt journal's reversal, when the original is in the screen copy. */
export function reversalJournalForStore(journals: Row[], originalRef: string, revRef: string, reason: string, at: string): Row | null {
  if (journals.some(j => j?.ref === revRef)) return null
  const original = journals.find(j => j?.ref === originalRef)
  if (!original) return null
  const lines = (Array.isArray(original.lines) ? original.lines : []).map((l: Row) => ({
    ...l,
    description: `Reversal of ${original.ref}: ${l.description ?? ''}`,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
  }))
  return {
    ...original,
    id: `rev-${String(original.id ?? originalRef)}`.slice(0, 80),
    ref: revRef,
    date: at.slice(0, 10),
    source: 'manual',
    description: `Payment reversed — ${reason} (reversal of ${original.description ?? original.ref})`,
    lines,
    totalDebit: Number(original.totalCredit) || 0,
    totalCredit: Number(original.totalDebit) || 0,
  }
}

/**
 * Store-write guard: a tab opened before the reversal still holds the payment
 * on the invoice. Its next save must not bring it back.
 */
export function keepReversedPaymentsOff(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming
  const voidedById = new Map<string, Row[]>()
  for (const row of current) {
    if (row && Array.isArray(row.voidedPayments) && row.voidedPayments.length) voidedById.set(String(row.id), row.voidedPayments)
  }
  if (!voidedById.size) return incoming
  return incoming.map((row: unknown) => {
    if (!row || typeof row !== 'object') return row
    const next = row as Row
    const voided = voidedById.get(String(next.id))
    if (!voided) return row
    const ids = new Set(voided.map(p => String(p?.id)))
    const payments = Array.isArray(next.payments) ? next.payments : []
    const stale = payments.filter((p: Row) => ids.has(String(p?.id)))
    const knownVoided = Array.isArray(next.voidedPayments) ? next.voidedPayments : []
    if (!stale.length && knownVoided.length >= voided.length) return row
    const staleTotal = stale.reduce((s: number, p: Row) => s + (Number(p.amount) || 0), 0)
    return {
      ...next,
      payments: payments.filter((p: Row) => !ids.has(String(p?.id))),
      amountPaid: Math.max(0, Math.round(((Number(next.amountPaid) || 0) - staleTotal) * 100) / 100),
      voidedPayments: knownVoided.length >= voided.length ? knownVoided : voided,
    }
  })
}
