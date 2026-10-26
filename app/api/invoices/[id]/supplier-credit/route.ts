import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { BankAccountRefError, cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { isPayableInvoiceStatus, paymentMethodEnum } from '@/lib/accounting/payment-allocations'
import { creditOpenAmount } from '@/lib/finance/vendor-credit-note'

/**
 * A supplier credit note (a vendor bill with a negative total, VCN/…) after it
 * is booked. Its journal already took the amount off what we owe the supplier
 * (Dr payables). What is left is what happens to that credit:
 *
 *  - apply:  use it on one of the supplier's unpaid bills. No money moves and
 *            no new journal — the credit's payables debit and the bill's
 *            payables credit already offset; this only records that this
 *            credit settles that bill, as a 'credit' payment on the bill.
 *  - refund: the supplier paid the credit back. Money comes in:
 *            Dr bank / cash, Cr payables.
 *
 * The credit's open amount is |total| − |amountPaid| (its amountPaid is kept
 * negative, the convention since credits were introduced).
 */
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const POSTED = new Set(['approved', 'invoiced'])

function fail(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status })
}

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as Record<string, any>
    const action = String(body.action || '')

    const credit = await prisma.invoice.findUnique({ where: { id } })
    if (!credit) fail('Credit note not found', 404)
    if (credit.documentType !== 'vendor_bill' || Number(credit.totalAmount) >= 0) fail('This is not a supplier credit note', 400)
    if (!POSTED.has(String(credit.status))) fail('Confirm the credit note first')
    const open = creditOpenAmount(credit)
    if (open <= 0) fail(`${credit.invoiceNumber} has no credit left to use`)

    const when = body.date ? new Date(String(body.date)) : new Date()
    if (Number.isNaN(when.getTime())) fail('Invalid date', 422)
    const lock = await checkFiscalLock(when)
    if (!lock.ok) fail(lock.error ?? 'That period is locked', lock.status ?? 409)

    if (action === 'apply') {
      const bill = await prisma.invoice.findUnique({ where: { id: String(body.billId || '') } })
      if (!bill) fail('Bill not found', 404)
      if (bill.documentType !== 'vendor_bill' || Number(bill.totalAmount) <= 0) fail('Pick a supplier bill', 400)
      if (bill.clientId !== credit.clientId) fail('The bill must be from the same supplier as the credit note')
      if (!isPayableInvoiceStatus(String(bill.status))) fail('Only a confirmed bill can take a credit')
      if (bill.paymentBlocked) fail('Payments are blocked on this bill')
      const owed = money(Number(bill.totalAmount) - Number(bill.amountPaid))
      if (owed <= 0) fail(`${bill.invoiceNumber} is already paid`)
      const amount = money(Math.min(Number(body.amount) || open, open, owed))
      if (amount <= 0) fail('Enter an amount to apply', 422)

      const result = await prisma.$transaction(async tx => {
        const payment = await tx.payment.create({
          data: {
            invoiceId: bill.id,
            amount,
            amountBase: amount,
            paymentType: 'vendor_credit',
            partnerId: bill.clientId,
            currencyCode: bill.currencyCode,
            paymentMethod: 'credit',
            reference: credit.invoiceNumber,
            externalReference: credit.invoiceNumber,
            reconciliationStatus: 'not_applicable',
            // Booked by the credit note's own journal; nothing new to post.
            postingStatus: 'posted',
            journalId: credit.postedJournalEntryId ?? null,
            paidAt: when,
            notes: `method:vendor_credit · Credit ${credit.invoiceNumber} applied`,
            createdById: actor.id,
          },
        })
        await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: bill.id, amount, applicationDate: when } })
        const updatedBill = await tx.invoice.update({ where: { id: bill.id }, data: { amountPaid: money(Number(bill.amountPaid) + amount) } })
        const updatedCredit = await tx.invoice.update({
          where: { id: credit.id },
          data: {
            amountPaid: money(Number(credit.amountPaid) - amount),
            notes: [credit.notes, `Used on ${bill.invoiceNumber}: ${amount.toLocaleString('en-KE')}`].filter(Boolean).join('\n'),
          },
        })
        await writeFinancialAuditInTx(tx, {
          userId: actor.id, action: 'apply_supplier_credit', entityType: 'invoice', entityId: credit.id,
          oldValues: { creditOpen: open, billOwed: owed },
          newValues: { billId: bill.id, billRef: bill.invoiceNumber, amount, paymentId: payment.id },
        })
        return { bill: updatedBill, credit: updatedCredit, amount }
      })
      await refreshScreens()
      return NextResponse.json({ ok: true, applied: result.amount, billRef: bill.invoiceNumber, creditOpen: creditOpenAmount(result.credit) })
    }

    if (action === 'refund') {
      const amount = money(Math.min(Number(body.amount) || open, open))
      if (amount <= 0) fail('Enter the amount the supplier paid back', 422)
      const method = paymentMethodEnum(body.paymentMethod || 'bank_transfer')
      if (method === 'credit') fail('A refund is money received — pick how it was paid', 422)
      let cashLabel = method === 'bank_transfer' ? labelForRole('bank_absa') : labelForRole('cash_mobile')
      if (body.bankAccountId) {
        try { cashLabel = await cashLabelForBankAccount(prisma, String(body.bankAccountId)) } catch (err) {
          if (err instanceof BankAccountRefError) fail(err.message, err.status)
          throw err
        }
      }
      const reference = String(body.reference ?? '').trim().slice(0, 80) || null
      const result = await prisma.$transaction(async tx => {
        const payment = await tx.payment.create({
          data: {
            invoiceId: credit.id,
            amount,
            amountBase: amount,
            paymentType: 'vendor_refund',
            partnerId: credit.clientId,
            currencyCode: credit.currencyCode,
            paymentMethod: method as any,
            bankAccountId: body.bankAccountId && /^[0-9a-f-]{36}$/i.test(String(body.bankAccountId)) ? String(body.bankAccountId) : null,
            reference,
            paidAt: when,
            notes: `method:vendor_refund · Refund of credit ${credit.invoiceNumber}`,
            createdById: actor.id,
          },
        })
        const journal = await createJournalEntryInTx(tx, {
          ref: `JRN/VREF/${credit.invoiceNumber}/${payment.id.slice(0, 8)}`.slice(0, 80),
          journalCode: method === 'cash' || method === 'mpesa' ? 'CSH' : 'BNK',
          date: when,
          description: `Supplier refund of credit ${credit.invoiceNumber}`,
          sourceType: 'payment',
          sourceId: payment.id,
          invoiceId: credit.id,
          paymentId: payment.id,
          createdById: actor.id,
          lines: [
            { accountLabel: cashLabel, label: `Refund received ${credit.invoiceNumber}`, debit: amount, credit: 0, partnerId: credit.clientId },
            { accountLabel: labelForRole('ap'), label: `Supplier credit ${credit.invoiceNumber} refunded`, debit: 0, credit: amount, partnerId: credit.clientId },
          ],
        })
        await tx.payment.update({ where: { id: payment.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
        const updatedCredit = await tx.invoice.update({
          where: { id: credit.id },
          data: {
            amountPaid: money(Number(credit.amountPaid) - amount),
            notes: [credit.notes, `Refunded by supplier: ${amount.toLocaleString('en-KE')}${reference ? ` (${reference})` : ''}`].filter(Boolean).join('\n'),
          },
        })
        await writeFinancialAuditInTx(tx, {
          userId: actor.id, action: 'refund_supplier_credit', entityType: 'invoice', entityId: credit.id, relatedJournalId: journal.id,
          oldValues: { creditOpen: open },
          newValues: { amount, method, reference, paymentId: payment.id },
        })
        return updatedCredit
      })
      await refreshScreens()
      return NextResponse.json({ ok: true, refunded: amount, creditOpen: creditOpenAmount(result) })
    }

    fail('Unknown action — use apply or refund', 400)
  })
}

async function refreshScreens() {
  try {
    const { refreshInvoicesBlob } = await import('@/lib/documents-broadcast.server')
    await refreshInvoicesBlob()
  } catch (err) {
    console.error('[supplier-credit] invoices refresh failed:', err)
  }
}
