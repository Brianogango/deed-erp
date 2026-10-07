import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import {
  canPayOwnPostedInvoice,
  canPostOrPayCustomerInvoice,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES,
} from '@/lib/finance-controls'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { resolveBlobInvoiceMirror } from '@/lib/accounting/resolve-invoice-mirror'
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { labelForRole, cashAccountRoleForBankId } from '@/lib/accounting/coa-roles'
import { isUuid } from '@/lib/legacy-compat'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

// A DB status is payable when it represents a validated (posted) AR document.
// This mirrors the client-side `invoiceDocState()` projection so the "Register
// payment" button and this guard never disagree: posting stores the status as
// 'approved'/'invoiced' (see INVOICE_STATUS_MAP), and legacy payment-progress
// values ('paid', 'partially_paid', 'overdue', …) are still posted documents.
// 'pending_approval' and 'rejected' are explicitly excluded — they are not yet
// (or never were) posted, even though invoiceDocState() would otherwise treat
// any non-draft/cancelled status as posted.
function isPayableInvoiceStatus(status: string): boolean {
  if (status === 'pending_approval' || status === 'rejected') return false
  return invoiceDocState(status) === 'posted'
}

export async function POST(
  request: Request,
  { params }: { params: RouteParams<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const { id: invoiceId } = await resolveRouteParams(params)
    const body = await request.json()

    const {
      amount,
      paymentMethod = 'cash',
      reference,
      paidAt,
      bankAccountId,
      idempotencyKey,
    } = body
    // Booking a payment that was already received and recorded on screen
    // (screen-ledger repair): no "payment received" message to the customer.
    const silent = body.silent === true && actor.role === 'director'

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const paymentDate = paidAt ? new Date(String(paidAt)) : new Date()
    const lock = await checkFiscalLock(paymentDate)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Blob status is what the invoice screen shows (POSTED). Accounting dual-write
    // can leave Prisma as draft when posting PUT failed (tax category, lock, …).
    const blobMirror = await resolveBlobInvoiceMirror(invoiceId)
    const blobStatus = String(blobMirror.status || '')
    const blobLooksPosted = Boolean(blobStatus)
      && invoiceDocState(blobStatus) === 'posted'
      && blobStatus !== 'pending_approval'
      && blobStatus !== 'rejected'

    let payableInvoice = invoice
    if (!isPayableInvoiceStatus(String(invoice.status))) {
      if (invoice.status === 'draft' && blobLooksPosted) {
        payableInvoice = await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'approved' },
        })
      } else {
        return NextResponse.json({ error: 'Only posted invoices can receive payments' }, { status: 409 })
      }
    }
    if (payableInvoice.paymentBlocked) {
      return NextResponse.json({ error: 'Payments are blocked on this invoice' }, { status: 409 })
    }

    // Threshold / SoD from system settings + store postedBy mirror
    try {
      const state = await loadAppState(['deed_invoices', 'deed_systemSettings'])
      const invoices = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
      const mirror = invoices.find(i => i.id === invoiceId)
      const settings = (state.deed_systemSettings && typeof state.deed_systemSettings === 'object')
        ? state.deed_systemSettings as Record<string, unknown>
        : {}
      const sodThreshold = Number(settings.accAdminOfficerInvoiceLimitKes) || DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
      // Prisma invoices are customer AR documents; vendor bills live primarily in the store mirror.
      const invoiceType = (mirror?.type === 'vendor_bill') ? 'vendor_bill' : 'customer_invoice'
      const invoiceTotal = Number(invoice.totalAmount)
      const gate = canPostOrPayCustomerInvoice({
        role: actor.role,
        invoiceType,
        action: 'pay',
      })
      if (!gate.ok) {
        return NextResponse.json({ error: gate.reason || 'Forbidden' }, { status: 403 })
      }
      const sod = canPayOwnPostedInvoice({
        role: actor.role,
        actorUserId: actor.id,
        postedByUserId: typeof mirror?.postedByUserId === 'string'
          ? mirror.postedByUserId
          : blobMirror.postedByUserId,
        invoiceTotal,
        sodThresholdKes: sodThreshold,
      })
      if (!sod.ok) {
        return NextResponse.json({ error: sod.reason || 'Segregation of duties' }, { status: 409 })
      }
    } catch {
      // If store mirror unavailable, still enforce role + posted status above
    }

    // A supplier bill is paid out: Dr Accounts Payable / Cr bank. This route
    // used to post every payment as a customer receipt (Dr bank / Cr AR), so a
    // bill payment raised the bank balance instead of lowering it.
    const isBill = invoiceDocumentType(invoice) === 'vendor_bill'

    const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid)
    if (balance <= 0) {
      return NextResponse.json({ error: 'Invoice already fully paid' }, { status: 400 })
    }

    const capped = Math.min(Number(amount), balance)
    const newAmountPaid = Number(invoice.amountPaid) + capped

    const notesParts = [
      bankAccountId ? `Account: ${bankAccountId}` : null,
      idempotencyKey ? `idempotency:${idempotencyKey}` : null,
    ].filter(Boolean)
    const notes = notesParts.length ? notesParts.join(' · ') : null

    // Resolve the actual cash/bank GL server-side. A caller may select a business
    // bank account, but never supplies the GL label that will be posted.
    const method = String(paymentMethod).toLowerCase()
    // Applying a customer credit moves no cash: it settles the receivable
    // against the credit liability. Without this branch the method falls
    // through to petty cash below and the receipt debits 2211, overstating
    // cash and leaving 3313 untouched.
    const isCreditApplication = method === 'customer_credit' && !isBill
    let cashAccountLabel = isCreditApplication
      ? labelForRole('customer_credits')
      : method === 'bank_transfer'
        ? labelForRole('bank_absa')
        : labelForRole('cash_mobile')
    // A credit application is never re-pointed at a bank GL, whatever the
    // caller sent as bankAccountId.
    if (!isCreditApplication && bankAccountId && isUuid(bankAccountId)) {
      const bank = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
      if (!bank || !bank.isActive) {
        return NextResponse.json({ error: 'Invalid or inactive bank account' }, { status: 400 })
      }
      const gl = await prisma.accountCode.findUnique({ where: { id: bank.glAccountId } })
      if (!gl || !gl.isActive) {
        return NextResponse.json({ error: 'Bank account is not mapped to an active GL account' }, { status: 409 })
      }
      cashAccountLabel = `${gl.code} - ${gl.name}`
    } else if (!isCreditApplication && bankAccountId) {
      // Blob cashbook id ('ncba', 'im', …) — resolve via the role map.
      cashAccountLabel = labelForRole(cashAccountRoleForBankId(bankAccountId))
    }

    const { recordPaymentWithAllocations } = await import('@/lib/accounting/payment-allocations')
    const result = await recordPaymentWithAllocations({
      amount: capped,
      paymentMethod,
      reference: reference || null,
      externalReference: reference || null,
      paidAt: paymentDate,
      notes,
      createdById: actor.id,
      invoiceId,
      paymentType: isBill ? 'vendor_payment' : 'customer_receipt',
      partnerId: invoice.clientId,
      bankAccountId: bankAccountId || null,
      currencyCode: invoice.currencyCode,
      exchangeRateToBase: Number(invoice.exchangeRateToBase || 1),
      idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : undefined,
      allocations: [{ invoiceId, amount: capped }],
      journal: paymentId => ({
        ref: `JRN/PAY/${invoice.invoiceNumber}/${paymentId}`.slice(0, 80),
        // A credit application belongs in the general journal, not a cash book.
        journalCode: isCreditApplication
          ? 'MISC'
          : method === 'cash' || method === 'mpesa' ? 'CSH' : 'BNK',
        date: paymentDate,
        description: `${isBill ? 'Supplier payment' : 'Customer receipt'} for ${invoice.invoiceNumber}`,
        sourceType: 'payment',
        sourceId: paymentId,
        invoiceId,
        paymentId,
        createdById: actor.id,
        skipIfExists: true,
        lines: isBill
          ? [
              {
                accountLabel: labelForRole('ap'),
                label: `AP settlement ${invoice.invoiceNumber}`,
                debit: capped,
                credit: 0,
                partnerId: invoice.clientId,
              },
              {
                accountLabel: cashAccountLabel,
                label: `Payment for ${invoice.invoiceNumber}`,
                debit: 0,
                credit: capped,
                partnerId: invoice.clientId,
              },
            ]
          : [
              {
                accountLabel: cashAccountLabel,
                label: `Receipt for ${invoice.invoiceNumber}`,
                debit: capped,
                credit: 0,
                partnerId: invoice.clientId,
              },
              {
                accountLabel: labelForRole('ar'),
                label: `AR settlement ${invoice.invoiceNumber}`,
                debit: 0,
                credit: capped,
                partnerId: invoice.clientId,
              },
            ],
      }),
      audit: async (tx, paymentRow, allocationRows) => {
        await writeFinancialAuditInTx(tx, {
          userId: actor.id,
          action: 'record_invoice_payment',
          entityType: 'invoice',
          entityId: invoiceId,
          oldValues: { amountPaid: Number(invoice.amountPaid), status: invoice.status },
          newValues: {
            paymentAmount: capped,
            paymentMethod,
            idempotencyKey,
            paymentId: paymentRow.id,
            allocationIds: allocationRows.map((a: any) => a.id),
          },
        })
      },
    })
    const { payment, allocations } = result

    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })

    // The Finance screens read the deed_invoices store mirror, which used to be
    // updated only by the browser's follow-up sync. If that sync never arrived
    // (tab closed, offline, conflict) the ledger and invoices table showed the
    // payment while the bill still read unpaid. Raise the mirror here too; it
    // only ever moves amountPaid upward and never fails the payment.
    if (updatedInvoice) try {
      const state = await loadAppState(['deed_invoices'])
      const mirror = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
      const row = mirror.find(i => i.id === invoiceId)
      const paid = Number(updatedInvoice.amountPaid)
      if (row && (Number(row.amountPaid) || 0) < paid) {
        row.amountPaid = paid
        await saveStoreKeys({ deed_invoices: JSON.stringify(mirror) })
      }
    } catch (err) {
      console.error('[invoice-payment] mirror amountPaid sync failed:', err)
    }

    // Audit was committed inside the same serializable transaction as the payment and journal.

    // Automation #2: customer payment confirmation (email + WhatsApp when phone exists).
    // Never fail the payment if messaging fails. Skip on idempotent retries above.
    // A supplier is not sent a "we received your payment" message.
    if (!result.idempotent && !isBill && !silent) try {
      const { notifyCustomerPaymentReceived } = await import('@/lib/finance/payment-receipt-notify')
      await notifyCustomerPaymentReceived({
        invoiceId,
        paymentId: payment.id,
        amount: capped,
        paymentMethod,
        reference: reference || null,
        paidAt: payment.paidAt ?? paymentDate,
        actorUserId: actor.id,
        actorName: actor.name || actor.username || null,
      })
    } catch (err) {
      console.error('[invoice-payment] receipt notify failed:', err)
    }
    if (!result.idempotent && !isBill && !silent) {
      const { notifyInvoicePayment } = await import('@/lib/notifications/business-events')
      await notifyInvoicePayment({ invoiceId, paymentId: payment.id, amount: capped, actorUserId: actor.id })
    }

    return NextResponse.json({ payment, invoice: updatedInvoice, idempotent: result.idempotent })
  })
}

export async function GET(
  _request: Request,
  { params }: { params: RouteParams<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    await requireRole([...WRITE_ROLES])
    const { id } = await resolveRouteParams(params)
    // Payments on this invoice, including ones spread over several invoices.
    const payments = await prisma.payment.findMany({
      where: { isVoided: false, OR: [{ invoiceId: id }, { allocations: { some: { invoiceId: id, reversedAt: null } } }] },
      orderBy: { paidAt: 'asc' },
    })
    return NextResponse.json(payments)
  })
}
