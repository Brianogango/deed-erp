import 'server-only'
import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export type CreditNoteLineInput = {
  invoiceItemId: string
  qty: number
  reason?: string
  returnToStock?: boolean
}

export async function createCustomerCreditNote(input: {
  invoiceId: string
  creditNoteNumber: string
  lines: CreditNoteLineInput[]
  reason: string
  actorId: string
}) {
  if (!input.lines.length) throw new Error('Credit note requires at least one invoice line')

  return prisma.$transaction(async tx => {
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      include: { items: true, client: true },
    })
    if (!invoice) throw new Error('Invoice not found')
    if (!['approved','invoiced','dispatched','delivered'].includes(String(invoice.status))) {
      throw new Error('Credit notes require a posted invoice')
    }

    const existingCredits = await tx.creditNote.findMany({
      where: { invoiceId: invoice.id, status: { not: 'cancelled' } },
      select: { amount: true },
    })
    const remainingCreditCapacity = money(
      Number(invoice.totalAmount) - existingCredits.reduce((sum, c) => sum + Number(c.amount), 0),
    )
    if (remainingCreditCapacity <= 0) throw new Error('Invoice has already been fully credited')

    const byId = new Map(invoice.items.map(i => [i.id, i]))
    const normalized = input.lines.map(req => {
      const item = byId.get(req.invoiceItemId)
      if (!item) throw new Error(`Invoice line not found: ${req.invoiceItemId}`)
      const qty = Number(req.qty)
      if (!Number.isFinite(qty) || qty <= 0 || qty > Number(item.qty)) {
        throw new Error(`Invalid credit quantity for invoice line ${req.invoiceItemId}`)
      }
      if (req.returnToStock) {
        throw new Error('Stock-return credits must be processed through the inventory return workflow so the original cost layer is reversed atomically.')
      }
      const ratio = qty / Number(item.qty)
      const base = money(Number(item.lineSubtotal) * ratio)
      const tax = money(Number(item.lineTax) * ratio)
      const total = money(base + tax)
      return { req, item, qty, base, tax, total }
    })

    // Prevent cumulative line over-crediting.
    for (const row of normalized) {
      const prior = await tx.creditNoteLine.aggregate({
        where: { originalInvoiceItemId: row.item.id },
        _sum: { qty: true, lineTotal: true },
      })
      const priorQty = Number(prior._sum.qty || 0)
      if (priorQty + row.qty > Number(row.item.qty) + 1e-9) {
        throw new Error(`Credit quantity exceeds original invoice quantity for line ${row.item.id}`)
      }
    }

    const subtotal = money(normalized.reduce((s, x) => s + x.base, 0))
    const taxAmount = money(normalized.reduce((s, x) => s + x.tax, 0))
    const amount = money(subtotal + taxAmount)
    if (amount <= 0 || amount > remainingCreditCapacity + 0.009) {
      throw new Error(`Credit amount ${amount} exceeds remaining invoice credit capacity ${remainingCreditCapacity}`)
    }

    const allocations = await tx.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id, payment: { isVoided: false } },
      _sum: { amount: true },
    })
    const invoiceResidual = money(Number(invoice.totalAmount) - Number(allocations._sum.amount || 0))
    const applyToAr = money(Math.min(amount, Math.max(0, invoiceResidual)))
    const customerCredit = money(amount - applyToAr)

    const credit = await tx.creditNote.create({
      data: {
        creditNoteNumber: input.creditNoteNumber,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        amount,
        subtotal,
        taxAmount,
        reason: input.reason.slice(0, 500),
        status: customerCredit > 0 ? 'partially_applied' : 'applied',
        postingStatus: 'posting',
        taxPoint: new Date(),
        createdById: input.actorId,
      },
    })

    for (const row of normalized) {
      await tx.creditNoteLine.create({
        data: {
          creditNoteId: credit.id,
          originalInvoiceItemId: row.item.id,
          description: row.item.description,
          qty: row.qty,
          unitPrice: row.item.unitPrice,
          taxableBase: row.base,
          taxCategory: (row.item as any).taxCategory || 'not_selected',
          taxRate: row.item.taxRate,
          taxAmount: row.tax,
          lineTotal: row.total,
          stockReturnRequired: false,
        },
      })
    }

    const journalLines: any[] = [
      { accountLabel: '5000 - Sales Revenue', label: `Revenue reversal ${input.creditNoteNumber}`, debit: subtotal, credit: 0, partnerId: invoice.clientId },
    ]
    if (taxAmount > 0) {
      journalLines.push({ accountLabel: labelForRole('output_vat'), label: `VAT reversal ${input.creditNoteNumber}`, debit: taxAmount, credit: 0, partnerId: invoice.clientId })
    }
    if (applyToAr > 0) {
      journalLines.push({ accountLabel: labelForRole('ar'), label: `AR credit ${invoice.invoiceNumber}`, debit: 0, credit: applyToAr, partnerId: invoice.clientId })
    }
    if (customerCredit > 0) {
      journalLines.push({ accountLabel: labelForRole('customer_credits'), label: `Customer credit balance ${input.creditNoteNumber}`, debit: 0, credit: customerCredit, partnerId: invoice.clientId })
    }

    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/CN/${input.creditNoteNumber}`.slice(0,80),
      journalCode: 'SAL',
      date: new Date(),
      description: `Customer credit note ${input.creditNoteNumber} against ${invoice.invoiceNumber}`,
      sourceType: 'credit_note',
      sourceId: credit.id,
      invoiceId: invoice.id,
      createdById: input.actorId,
      skipIfExists: false,
      lines: journalLines,
    })

    if (applyToAr > 0) {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: applyToAr,
          amountBase: applyToAr,
          paymentType: 'customer_credit',
          partnerId: invoice.clientId,
          currencyCode: invoice.currencyCode,
          exchangeRateToBase: invoice.exchangeRateToBase,
          paymentMethod: 'credit',
          reference: input.creditNoteNumber,
          externalReference: input.creditNoteNumber,
          idempotencyKey: `credit-note:${credit.id}`,
          reconciliationStatus: 'not_applicable',
          postingStatus: 'posted',
          journalId: journal.id,
          notes: `Credit application ${input.creditNoteNumber}`,
          createdById: input.actorId,
        },
      })
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amount: applyToAr, applicationDate: new Date() },
      })
      await tx.creditApplication.create({
        data: { creditNoteId: credit.id, invoiceId: invoice.id, amount: applyToAr, journalEntryId: journal.id },
      })
      const newPaid = money(Number(allocations._sum.amount || 0) + applyToAr)
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid } })
    }

    for (const row of normalized) {
      await tx.taxTransaction.create({
        data: {
          sourceType: 'credit_note',
          sourceId: credit.id,
          sourceLineId: row.item.id,
          direction: 'output',
          taxCategory: (row.item as any).taxCategory || 'not_selected',
          taxRate: row.item.taxRate,
          taxableBase: money(-row.base),
          taxAmount: money(-row.tax),
          taxPoint: new Date(),
          taxPeriod: new Date().toISOString().slice(0,7),
          partnerPin: invoice.client?.kraPin ?? null,
          etimsControlUnitNo: invoice.etimsControlUnitNumber,
          etimsInvoiceNo: invoice.etimsInvoiceNumber,
          transmissionStatus: 'pending',
          inputClaimEligible: false,
          journalEntryId: journal.id,
        },
      })
    }

    await tx.creditNote.update({
      where: { id: credit.id },
      data: {
        postingStatus: 'posted',
        postedJournalEntryId: journal.id,
        postedAt: new Date(),
        postedById: input.actorId,
      },
    })

    await writeFinancialAuditInTx(tx, {
      userId: input.actorId,
      action: 'post_credit_note',
      entityType: 'credit_note',
      entityId: credit.id,
      relatedJournalId: journal.id,
      newValues: { invoiceId: invoice.id, amount, subtotal, taxAmount, applyToAr, customerCredit },
    })

    return {
      id: credit.id,
      ref: credit.creditNoteNumber,
      invoiceId: invoice.id,
      amount,
      subtotal,
      taxAmount,
      appliedToAr: applyToAr,
      customerCredit,
      journalId: journal.id,
    }
  }, { isolationLevel: 'Serializable' })
}
