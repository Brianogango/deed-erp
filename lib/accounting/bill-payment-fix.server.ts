import 'server-only'

import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { correctBillPaymentLines, planBillPaymentFix, type BillPaymentFixPlan } from '@/lib/accounting/bill-payment-fix'

/** Every bill payment on the ledger that was booked as a customer receipt. */
export async function findBillPaymentFixes(): Promise<BillPaymentFixPlan[]> {
  const payments = await prisma.payment.findMany({
    where: { isVoided: false, invoiceId: { not: null } },
    select: {
      id: true, amount: true, paidAt: true, journalId: true,
      invoice: { select: { id: true, invoiceNumber: true, documentType: true, purchaseOrderId: true, client: { select: { name: true } } } },
    },
  })
  const onBills = payments.filter(p => p.invoice && invoiceDocumentType(p.invoice) === 'vendor_bill')
  if (!onBills.length) return []
  const journals = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { paymentId: { in: onBills.map(p => p.id) } },
        { id: { in: onBills.map(p => p.journalId).filter((id): id is string => Boolean(id)) } },
      ],
      reversalOfId: null,
    },
    select: { id: true, ref: true, entryDate: true, isReversed: true, paymentId: true, lines: { select: { accountLabel: true, debit: true, credit: true } } },
  })
  const plans: BillPaymentFixPlan[] = []
  for (const p of onBills) {
    const mine = journals
      .filter(j => j.paymentId === p.id || j.id === p.journalId)
      .map(j => ({ ...j, lines: j.lines.map(l => ({ accountLabel: l.accountLabel, debit: Number(l.debit), credit: Number(l.credit) })) }))
    const plan = planBillPaymentFix({
      payment: { id: p.id, amount: Number(p.amount), paidAt: p.paidAt },
      bill: { id: p.invoice!.id, invoiceNumber: p.invoice!.invoiceNumber, supplier: p.invoice!.client?.name ?? '' },
      journals: mine,
    })
    if (plan) plans.push(plan)
  }
  return plans.sort((a, b) => a.paidAt.localeCompare(b.paidAt))
}

/**
 * Correct them: each wrong entry reversed and, where none exists, the right
 * one posted — on the payment's own date when that period is open, otherwise
 * today. One transaction per payment, audited.
 */
export async function applyBillPaymentFixes(actorId: string) {
  const plans = await findBillPaymentFixes()
  const today = new Date()
  const results: Array<{ billNumber: string; amount: number; status: 'fixed' | 'failed'; message: string }> = []
  for (const plan of plans) {
    try {
      const open = await checkFiscalLock(plan.paidAt)
      const date = open.ok ? new Date(`${plan.paidAt}T12:00:00.000Z`) : today
      await prisma.$transaction(async tx => {
        for (const wrong of plan.reverse) {
          const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: wrong.id }, include: { lines: true, journal: { select: { code: true } } } })
          if (original.isReversed) continue
          const reversal = await createJournalEntryInTx(tx, {
            ref: `REV/${original.ref}`.slice(0, 80),
            journalCode: original.journal?.code ?? undefined,
            date,
            description: `Bill payment booked as a customer receipt — reversal of ${original.ref}`,
            sourceType: 'payment_fix',
            sourceId: `rev:${original.id}`,
            invoiceId: original.invoiceId,
            paymentId: plan.paymentId,
            createdById: actorId,
            skipIfExists: true,
            lines: original.lines.map(l => ({
              accountLabel: l.accountLabel,
              label: `Reversal: ${l.label ?? ''}`,
              debit: Number(l.credit),
              credit: Number(l.debit),
              partnerId: l.partnerId,
            })),
          })
          await tx.journalEntry.update({ where: { id: original.id }, data: { isReversed: true } })
          await tx.journalEntry.update({ where: { id: reversal.id }, data: { reversalOfId: original.id } })
        }
        let journalId: string | undefined
        if (plan.postCorrect) {
          const correct = await createJournalEntryInTx(tx, {
            ref: `JRN/PAY-AP/${plan.billNumber}/${plan.paymentId}`.slice(0, 80),
            journalCode: /bank|absa|ncba|equity|kcb|im\b/i.test(plan.cashAccount) ? 'BNK' : 'CSH',
            date,
            description: `Supplier payment for ${plan.billNumber} (corrected)`,
            sourceType: 'payment_fix',
            sourceId: `ap:${plan.paymentId}`,
            invoiceId: plan.billId,
            paymentId: plan.paymentId,
            createdById: actorId,
            skipIfExists: true,
            lines: correctBillPaymentLines(plan, labelForRole('ap')),
          })
          journalId = correct.id
        }
        await tx.payment.update({
          where: { id: plan.paymentId },
          data: { paymentType: 'vendor_payment', ...(journalId ? { journalId, postingStatus: 'posted' } : {}) },
        })
        await writeFinancialAuditInTx(tx, {
          userId: actorId,
          action: 'fix_bill_payment_journal',
          entityType: 'payment',
          entityId: plan.paymentId,
          oldValues: { reversed: plan.reverse.map(r => r.ref) },
          newValues: { postedCorrect: plan.postCorrect, date: date.toISOString().slice(0, 10), bill: plan.billNumber, amount: plan.amount },
        })
      }, { isolationLevel: 'Serializable' })
      results.push({ billNumber: plan.billNumber, amount: plan.amount, status: 'fixed', message: open.ok ? `Corrected on ${plan.paidAt}` : `Period locked — corrected today` })
    } catch (err) {
      results.push({ billNumber: plan.billNumber, amount: plan.amount, status: 'failed', message: err instanceof Error ? err.message : 'could not post' })
    }
  }
  return results
}
