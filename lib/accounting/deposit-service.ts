import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { cashAccountRoleForBankId, cashAccountRoleForMethod, labelForRole } from '@/lib/accounting/coa-roles'
import { isUuid } from '@/lib/legacy-compat'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { paymentUnallocated } from '@/lib/accounting/residuals'
import { bankAccountFk } from '@/lib/accounting/bank-account-ref'

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

async function cashAccountLabel(tx: Prisma.TransactionClient, method: string, bankAccountId?: string | null) {
  if (bankAccountId) {
    // Blob cashbook ids ('ncba', 'im', 'absa'…) are not Prisma UUIDs — only
    // hit the table for a real bank-account id, else resolve via the role map.
    if (isUuid(bankAccountId)) {
      const bank = await tx.bankAccount.findUnique({ where: { id: bankAccountId } })
      if (!bank || !bank.isActive) throw new Error('Invalid or inactive bank account')
      const gl = await tx.accountCode.findUnique({ where: { id: bank.glAccountId } })
      if (!gl || !gl.isActive) throw new Error('Bank account is not mapped to an active GL account')
      return `${gl.code} - ${gl.name}`
    }
    return labelForRole(cashAccountRoleForBankId(bankAccountId))
  }
  return labelForRole(cashAccountRoleForMethod(method))
}

export async function createDepositWithReceipt(input: {
  id?: string
  ref: string
  customerId: string
  customerName: string
  customerPhone?: string
  items: Array<{ productId: string; productName: string; sku?: string; qty: number; unitPrice: number }>
  amount: number
  method: string
  paymentRef?: string | null
  bankAccountId?: string | null
  idempotencyKey?: string | null
  dueDate?: Date | null
  notes?: string | null
  actor: { id: string; name: string }
}) {
  const totalValue = money(input.items.reduce((sum, x) => sum + Number(x.qty) * Number(x.unitPrice), 0))
  const amount = money(input.amount)
  if (totalValue <= 0) throw new Error('Deposit order total must be greater than zero')
  if (amount <= 0 || amount > totalValue) throw new Error('Initial deposit must be positive and cannot exceed order total')
  if (input.items.some(x => !x.productId || !x.productName || Number(x.qty) <= 0 || Number(x.unitPrice) < 0)) {
    throw new Error('Each deposit item requires a product, positive quantity and valid unit price')
  }

  return prisma.$transaction(async tx => {
    if (input.idempotencyKey) {
      const prior = await tx.depositPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (prior) {
        return tx.deposit.findUniqueOrThrow({ where: { id: prior.depositId }, include: { items: true, payments: true } })
      }
    }

    const deposit = await tx.deposit.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        ref: input.ref,
        customerId: input.customerId,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        totalValue,
        totalPaid: amount,
        balance: money(totalValue - amount),
        status: amount >= totalValue ? 'fully_paid' : 'partially_paid',
        postingStatus: 'posting',
        currencyCode: 'KES',
        notes: input.notes ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: input.actor.name,
        createdById: input.actor.id,
        items: {
          create: input.items.map((x, i) => ({
            productId: x.productId,
            productName: x.productName,
            sku: x.sku ?? null,
            qty: Math.trunc(x.qty),
            unitPrice: money(x.unitPrice),
            lineTotal: money(Number(x.qty) * Number(x.unitPrice)),
            sortOrder: i,
          })),
        },
      },
    })

    const payment = await tx.depositPayment.create({
      data: {
        depositId: deposit.id,
        amount,
        method: input.method,
        paymentRef: input.paymentRef ?? null,
        externalReference: input.paymentRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        paymentType: 'receipt',
        bankAccountId: bankAccountFk(input.bankAccountId),
        currencyCode: 'KES',
        recordedBy: input.actor.name,
        createdById: input.actor.id,
      },
    })
    const cash = await cashAccountLabel(tx, input.method, input.bankAccountId)
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/DEP/${input.ref}/${payment.id}`.slice(0, 80),
      journalCode: String(input.method).toLowerCase() === 'cash' ? 'CSH' : 'BNK',
      date: payment.paidAt,
      description: `Customer deposit receipt ${input.ref}`,
      sourceType: 'deposit_receipt',
      sourceId: payment.id,
      createdById: input.actor.id,
      skipIfExists: false,
      lines: [
        { accountLabel: cash, label: `Deposit received from ${input.customerName}`, debit: amount, credit: 0 },
        { accountLabel: labelForRole('customer_deposits'), label: `Customer deposit liability ${input.ref}`, debit: 0, credit: amount },
      ],
    })
    await tx.depositPayment.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } })
    await tx.deposit.update({ where: { id: deposit.id }, data: { postingStatus: 'posted' } })
    await writeFinancialAuditInTx(tx, {
      userId: input.actor.id,
      action: 'create_deposit',
      entityType: 'deposit',
      entityId: deposit.id,
      relatedJournalId: journal.id,
      newValues: { ref: input.ref, totalValue, initialPayment: amount },
    })
    return tx.deposit.findUniqueOrThrow({ where: { id: deposit.id }, include: { items: true, payments: true } })
  }, { isolationLevel: 'Serializable' })
}

export async function addDepositReceipt(input: {
  depositId: string
  amount: number
  method: string
  paymentRef?: string | null
  bankAccountId?: string | null
  idempotencyKey?: string | null
  actor: { id: string; name: string }
}) {
  return prisma.$transaction(async tx => {
    if (input.idempotencyKey) {
      const prior = await tx.depositPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (prior) return tx.deposit.findUniqueOrThrow({ where: { id: prior.depositId }, include: { items: true, payments: true } })
    }
    const deposit = await tx.deposit.findUniqueOrThrow({ where: { id: input.depositId } })
    if (!['active','partially_paid'].includes(deposit.status)) throw new Error('Cannot add payment to a deposit in this status')
    const amount = money(Math.min(Number(input.amount), Number(deposit.balance)))
    if (amount <= 0) throw new Error('Payment amount must be greater than zero')

    const payment = await tx.depositPayment.create({
      data: {
        depositId: deposit.id,
        amount,
        method: input.method,
        paymentRef: input.paymentRef ?? null,
        externalReference: input.paymentRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        paymentType: 'receipt',
        bankAccountId: bankAccountFk(input.bankAccountId),
        currencyCode: deposit.currencyCode,
        recordedBy: input.actor.name,
        createdById: input.actor.id,
      },
    })
    const cash = await cashAccountLabel(tx, input.method, input.bankAccountId)
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/DEP/${deposit.ref}/${payment.id}`.slice(0, 80),
      journalCode: String(input.method).toLowerCase() === 'cash' ? 'CSH' : 'BNK',
      date: payment.paidAt,
      description: `Customer deposit receipt ${deposit.ref}`,
      sourceType: 'deposit_receipt',
      sourceId: payment.id,
      createdById: input.actor.id,
      skipIfExists: false,
      lines: [
        { accountLabel: cash, label: `Deposit received ${deposit.ref}`, debit: amount, credit: 0 },
        { accountLabel: labelForRole('customer_deposits'), label: `Customer deposit liability ${deposit.ref}`, debit: 0, credit: amount },
      ],
    })
    await tx.depositPayment.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } })
    const totalPaid = money(Number(deposit.totalPaid) + amount)
    const balance = money(Number(deposit.totalValue) - totalPaid)
    await tx.deposit.update({
      where: { id: deposit.id },
      data: { totalPaid, balance, status: balance <= 0 ? 'fully_paid' : 'partially_paid', postingStatus: 'posted' },
    })
    await writeFinancialAuditInTx(tx, {
      userId: input.actor.id,
      action: 'record_deposit_payment',
      entityType: 'deposit',
      entityId: deposit.id,
      relatedJournalId: journal.id,
      newValues: { paymentId: payment.id, amount, totalPaid, balance },
    })
    return tx.deposit.findUniqueOrThrow({ where: { id: deposit.id }, include: { items: true, payments: true } })
  }, { isolationLevel: 'Serializable' })
}

export async function applyDepositToInvoice(input: {
  depositId: string
  invoiceId: string
  amount?: number
  actor: { id: string; name: string }
}) {
  return prisma.$transaction(async tx => {
    const deposit = await tx.deposit.findUniqueOrThrow({ where: { id: input.depositId } })
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } })
    if (!['approved','invoiced','dispatched','delivered'].includes(String(invoice.status))) {
      throw new Error('Deposit can only be applied to a posted customer invoice')
    }
    if (deposit.customerId && invoice.clientId && deposit.customerId !== invoice.clientId) {
      throw new Error('Deposit customer does not match invoice customer')
    }

    const receipts = await tx.depositPayment.aggregate({
      where: { depositId: deposit.id, paymentType: 'receipt' },
      _sum: { amount: true },
    })
    const refunds = await tx.depositPayment.aggregate({
      where: { depositId: deposit.id, paymentType: 'refund' },
      _sum: { amount: true },
    })
    const applications = await tx.depositApplication.aggregate({
      where: { depositId: deposit.id, status: 'applied' },
      _sum: { amount: true },
    })
    const available = money(Number(receipts._sum.amount || 0) - Number(refunds._sum.amount || 0) - Number(applications._sum.amount || 0))

    const existingAlloc = await tx.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id, payment: { isVoided: false } },
      _sum: { amount: true },
    })
    const residual = money(Number(invoice.totalAmount) - Number(existingAlloc._sum.amount || 0))
    const amount = money(Math.min(input.amount == null ? available : Number(input.amount), available, residual))
    if (amount <= 0) throw new Error('No deposit liability or invoice residual remains to apply')

    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        amountBase: amount,
        paymentType: 'customer_receipt',
        partnerId: invoice.clientId,
        currencyCode: invoice.currencyCode,
        exchangeRateToBase: invoice.exchangeRateToBase,
        paymentMethod: 'credit',
        reference: `DEP/${deposit.ref}`,
        externalReference: `DEP/${deposit.ref}`,
        idempotencyKey: `deposit-application:${deposit.id}:${invoice.id}:${money(Number(applications._sum.amount || 0) + amount)}`,
        postingStatus: 'posted',
        notes: `Applied customer deposit ${deposit.ref}`,
        createdById: input.actor.id,
      },
    })
    const allocation = await tx.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: invoice.id, amount, applicationDate: new Date() },
    })
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/DEP/APPLY/${deposit.ref}/${payment.id}`.slice(0, 80),
      journalCode: 'SAL',
      date: new Date(),
      description: `Apply customer deposit ${deposit.ref} to ${invoice.invoiceNumber}`,
      sourceType: 'deposit_application',
      sourceId: payment.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
      createdById: input.actor.id,
      skipIfExists: false,
      lines: [
        { accountLabel: labelForRole('customer_deposits'), label: `Clear deposit ${deposit.ref}`, debit: amount, credit: 0, partnerId: invoice.clientId },
        { accountLabel: labelForRole('ar'), label: `AR settlement ${invoice.invoiceNumber}`, debit: 0, credit: amount, partnerId: invoice.clientId },
      ],
    })
    await tx.payment.update({ where: { id: payment.id }, data: { journalId: journal.id } })
    await tx.depositApplication.create({
      data: { depositId: deposit.id, invoiceId: invoice.id, paymentId: payment.id, amount, journalEntryId: journal.id, createdById: input.actor.id },
    })
    const newPaid = money(Number(existingAlloc._sum.amount || 0) + amount)
    await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid } })
    const remainingDeposit = money(available - amount)
    await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        status: remainingDeposit <= 0 && Number(deposit.balance) <= 0 ? 'completed' : deposit.status,
        completedAt: remainingDeposit <= 0 && Number(deposit.balance) <= 0 ? new Date() : deposit.completedAt,
      },
    })
    await writeFinancialAuditInTx(tx, {
      userId: input.actor.id,
      action: 'apply_deposit',
      entityType: 'deposit',
      entityId: deposit.id,
      relatedJournalId: journal.id,
      newValues: { invoiceId: invoice.id, amount, paymentId: payment.id, allocationId: allocation.id },
    })
    return { amount, paymentId: payment.id, journalId: journal.id, invoiceResidual: paymentUnallocated(Number(invoice.totalAmount), newPaid), remainingDeposit }
  }, { isolationLevel: 'Serializable' })
}

export async function refundDeposit(input: {
  depositId: string
  amount?: number
  method: string
  bankAccountId?: string | null
  reference?: string | null
  reason: string
  actor: { id: string; name: string }
}) {
  return prisma.$transaction(async tx => {
    const deposit = await tx.deposit.findUniqueOrThrow({ where: { id: input.depositId } })
    const receipts = await tx.depositPayment.aggregate({ where: { depositId: deposit.id, paymentType: 'receipt' }, _sum: { amount: true } })
    const refunds = await tx.depositPayment.aggregate({ where: { depositId: deposit.id, paymentType: 'refund' }, _sum: { amount: true } })
    const apps = await tx.depositApplication.aggregate({ where: { depositId: deposit.id, status: 'applied' }, _sum: { amount: true } })
    const refundable = money(Number(receipts._sum.amount || 0) - Number(refunds._sum.amount || 0) - Number(apps._sum.amount || 0))
    const amount = money(Math.min(input.amount == null ? refundable : Number(input.amount), refundable))
    if (amount <= 0) throw new Error('No unapplied deposit balance remains to refund')
    const payment = await tx.depositPayment.create({
      data: {
        depositId: deposit.id,
        amount,
        method: input.method,
        paymentRef: input.reference ?? null,
        externalReference: input.reference ?? null,
        paymentType: 'refund',
        bankAccountId: bankAccountFk(input.bankAccountId),
        currencyCode: deposit.currencyCode,
        recordedBy: input.actor.name,
        createdById: input.actor.id,
      },
    })
    const cash = await cashAccountLabel(tx, input.method, input.bankAccountId)
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/DEP/REFUND/${deposit.ref}/${payment.id}`.slice(0, 80),
      journalCode: 'BNK',
      date: payment.paidAt,
      description: `Refund customer deposit ${deposit.ref}`,
      sourceType: 'deposit_refund',
      sourceId: payment.id,
      createdById: input.actor.id,
      skipIfExists: false,
      lines: [
        { accountLabel: labelForRole('customer_deposits'), label: `Refund deposit ${deposit.ref}`, debit: amount, credit: 0 },
        { accountLabel: cash, label: `Deposit refund ${deposit.ref}`, debit: 0, credit: amount },
      ],
    })
    await tx.depositPayment.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } })
    await tx.deposit.update({
      where: { id: deposit.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason },
    })
    await writeFinancialAuditInTx(tx, {
      userId: input.actor.id,
      action: 'refund_deposit',
      entityType: 'deposit',
      entityId: deposit.id,
      relatedJournalId: journal.id,
      approvalReason: input.reason,
      newValues: { amount, paymentId: payment.id },
    })
    return { amount, journalId: journal.id }
  }, { isolationLevel: 'Serializable' })
}
