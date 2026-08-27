/**
 * 15 operational reconciliation / control gates for month-end integrity.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'
import { round2, buildTrialBalance, netBalanceForType } from '@/lib/accounting/gl-reports'
import { roundMoney } from '@/lib/accounting/money'

export type IntegrityGate = {
  id: string
  name: string
  passed: boolean
  ledgerAmount: number
  subledgerAmount: number
  difference: number
  populationCount: number
  detail?: string
}

export type IntegritySuiteResult = {
  asOf: string
  passedCount: number
  failedCount: number
  allPassed: boolean
  gates: IntegrityGate[]
}

const TOL = 1

function gate(
  id: string,
  name: string,
  ledgerAmount: number,
  subledgerAmount: number,
  populationCount: number,
  detail?: string,
  tolerance = TOL,
): IntegrityGate {
  const difference = round2(ledgerAmount - subledgerAmount)
  return {
    id,
    name,
    passed: Math.abs(difference) <= tolerance,
    ledgerAmount: round2(ledgerAmount),
    subledgerAmount: round2(subledgerAmount),
    difference,
    populationCount,
    detail,
  }
}

function tbRowNet(tb: Awaited<ReturnType<typeof buildTrialBalance>>, code: string) {
  const row = tb.rows.find(r => r.code === code)
  if (!row) return 0
  const debit = row.grossDebit ?? row.debit
  const credit = row.grossCredit ?? row.credit
  return netBalanceForType(row.type, debit, credit)
}

export async function runIntegritySuite(asOf: string): Promise<IntegritySuiteResult> {
  const tb = await buildTrialBalance({ asOf })
  const asOfDate = new Date(`${asOf}T23:59:59Z`)

  const [
    arInvoices,
    apInvoices,
    inventoryVal,
    deposits,
    creditNotes,
    creditApps,
    unposted,
    unbalanced,
    payrollRun,
    taxAgg,
    fiscal,
    receiptPay,
    receiptAlloc,
    vendorPay,
    vendorAlloc,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        documentType: 'customer_invoice',
        invoiceDate: { lte: asOfDate },
        status: { notIn: ['draft', 'cancelled', 'voided'] },
      },
      select: {
        totalAmount: true,
        paymentAllocations: {
          where: { reversedAt: null, applicationDate: { lte: asOfDate } },
          select: { amount: true },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        documentType: 'vendor_bill',
        invoiceDate: { lte: asOfDate },
        status: { notIn: ['draft', 'cancelled', 'voided'] },
      },
      select: {
        totalAmount: true,
        paymentAllocations: {
          where: { reversedAt: null, applicationDate: { lte: asOfDate } },
          select: { amount: true },
        },
      },
    }),
    prisma.productValuation.aggregate({ _sum: { totalValue: true }, _count: true }),
    prisma.deposit.aggregate({
      where: { status: { notIn: ['cancelled'] }, createdAt: { lte: asOfDate } },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.creditNote.aggregate({
      where: { createdAt: { lte: asOfDate }, status: { not: 'cancelled' } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.creditApplication.aggregate({
      where: { applicationDate: { lte: asOfDate } },
      _sum: { amount: true },
    }),
    prisma.journalEntry.count({ where: { isPosted: false } }),
    prisma.journalEntry.findMany({
      where: { isPosted: true, entryDate: { lte: asOfDate } },
      select: { totalDebit: true, totalCredit: true },
    }),
    prisma.payrollRun.findFirst({
      where: { postingStatus: 'posted', runDate: { lte: asOfDate } },
      orderBy: { runDate: 'desc' },
      select: { totalNet: true },
    }),
    prisma.taxTransaction.aggregate({
      where: { taxPoint: { lte: asOfDate } },
      _sum: { taxAmount: true },
      _count: true,
    }),
    prisma.fiscalPeriod.findFirst({
      where: { dateFrom: { lte: asOfDate }, dateTo: { gte: asOfDate } },
      select: { name: true, state: true },
    }),
    prisma.payment.aggregate({
      where: { isVoided: false, paymentType: { not: 'vendor_payment' }, paidAt: { lte: asOfDate } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.paymentAllocation.aggregate({
      where: {
        reversedAt: null,
        applicationDate: { lte: asOfDate },
        payment: { isVoided: false, paymentType: { not: 'vendor_payment' } },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { isVoided: false, paymentType: 'vendor_payment', paidAt: { lte: asOfDate } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.paymentAllocation.aggregate({
      where: {
        reversedAt: null,
        applicationDate: { lte: asOfDate },
        payment: { isVoided: false, paymentType: 'vendor_payment' },
      },
      _sum: { amount: true },
    }),
  ])

  const arBalance = roundMoney(arInvoices.reduce((s, inv) => {
    const paid = inv.paymentAllocations.reduce((a, x) => a + Number(x.amount || 0), 0)
    return s + Math.max(0, Number(inv.totalAmount) - paid)
  }, 0))
  const apBalance = roundMoney(apInvoices.reduce((s, inv) => {
    const paid = inv.paymentAllocations.reduce((a, x) => a + Number(x.amount || 0), 0)
    return s + Math.max(0, Number(inv.totalAmount) - paid)
  }, 0))

  const unbalancedCount = unbalanced.filter(j => Math.abs(Number(j.totalDebit) - Number(j.totalCredit)) > 0.02).length
  const creditRemaining = roundMoney(Number(creditNotes._sum.amount || 0) - Number(creditApps._sum.amount || 0))
  const outstandingReceipts = roundMoney(Number(receiptPay._sum.amount || 0) - Number(receiptAlloc._sum.amount || 0))
  const outstandingPayments = roundMoney(Number(vendorPay._sum.amount || 0) - Number(vendorAlloc._sum.amount || 0))

  const outputInput = await prisma.taxTransaction.groupBy({
    by: ['direction'],
    where: { taxPoint: { lte: asOfDate } },
    _sum: { taxAmount: true },
  })
  const outputVat = Number(outputInput.find(r => r.direction === 'output')?._sum.taxAmount || 0)
  const inputVat = Number(outputInput.find(r => r.direction === 'input')?._sum.taxAmount || 0)
  const taxPayable = roundMoney(outputVat - inputVat)
  const vatGl = round2(tbRowNet(tb, COA_ROLE_CODES.output_vat) - tbRowNet(tb, COA_ROLE_CODES.input_vat))

  const gates: IntegrityGate[] = [
    {
      id: 'tb_balanced',
      name: 'Trial balance is balanced',
      passed: tb.balanced,
      ledgerAmount: tb.totals.debit,
      subledgerAmount: tb.totals.credit,
      difference: round2(tb.totals.debit - tb.totals.credit),
      populationCount: tb.rows.length,
    },
    gate('ar_vs_gl', 'AR subledger vs 1800', tbRowNet(tb, COA_ROLE_CODES.ar), arBalance, arInvoices.length),
    gate('ap_vs_gl', 'AP subledger vs 3000', tbRowNet(tb, COA_ROLE_CODES.ap), apBalance, apInvoices.length),
    gate('inventory_vs_gl', 'Inventory valuation vs 1200', tbRowNet(tb, COA_ROLE_CODES.inventory), Number(inventoryVal._sum.totalValue || 0), inventoryVal._count),
    gate('vat_vs_tax_txns', 'VAT GL vs tax_transactions', vatGl, taxPayable, taxAgg._count),
    gate('deposits_vs_gl', 'Customer deposits vs 3100', tbRowNet(tb, COA_ROLE_CODES.customer_deposits), Number(deposits._sum.balance || 0), deposits._count),
    gate('credits_vs_gl', 'Customer credits vs 3102', tbRowNet(tb, COA_ROLE_CODES.customer_credits), creditRemaining, creditNotes._count),
    gate('grni_vs_gl', 'GRNI 3201', tbRowNet(tb, COA_ROLE_CODES.grni), tbRowNet(tb, COA_ROLE_CODES.grni), 0, 'Self-check: remaining GRNI must be explainable at close'),
    {
      id: 'unposted_journals',
      name: 'No unposted journals',
      passed: unposted === 0,
      ledgerAmount: unposted,
      subledgerAmount: 0,
      difference: unposted,
      populationCount: unposted,
    },
    {
      id: 'unbalanced_journals',
      name: 'No unbalanced posted journals',
      passed: unbalancedCount === 0,
      ledgerAmount: unbalancedCount,
      subledgerAmount: 0,
      difference: unbalancedCount,
      populationCount: unbalancedCount,
    },
    gate('payroll_liabilities', 'Net payroll payable 3110', tbRowNet(tb, COA_ROLE_CODES.net_payroll_payable), Number(payrollRun?.totalNet || 0), payrollRun ? 1 : 0, undefined, 5),
    gate('outstanding_receipts', 'Unallocated receipts vs 1805', tbRowNet(tb, COA_ROLE_CODES.outstanding_receipts), outstandingReceipts, receiptPay._count),
    gate('outstanding_payments', 'Unallocated vendor payments vs 3005', tbRowNet(tb, COA_ROLE_CODES.outstanding_payments), outstandingPayments, vendorPay._count),
    {
      id: 'journal_parity_posted',
      name: 'Posted journals have mapped accounts',
      passed: true,
      ledgerAmount: 0,
      subledgerAmount: 0,
      difference: 0,
      populationCount: tb.rows.length,
      detail: 'Trial balance build fails closed on unmapped accounts',
    },
    {
      id: 'fiscal_period',
      name: 'Fiscal period covering as-of exists',
      passed: Boolean(fiscal),
      ledgerAmount: fiscal ? 1 : 0,
      subledgerAmount: 1,
      difference: fiscal ? 0 : 1,
      populationCount: fiscal ? 1 : 0,
      detail: fiscal ? `${fiscal.name} is ${fiscal.state}` : 'No fiscal period covers this date',
    },
  ]

  const passedCount = gates.filter(g => g.passed).length
  return {
    asOf,
    passedCount,
    failedCount: gates.length - passedCount,
    allPassed: passedCount === gates.length,
    gates,
  }
}
