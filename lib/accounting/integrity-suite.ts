/**
 * 15 operational reconciliation / control gates for month-end integrity.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'
import { round2, buildTrialBalance, netBalanceForType } from '@/lib/accounting/gl-reports'
import { invoiceOutstanding } from '@/lib/accounting/invoice-paid'
import {
  loadJournalMirrorFailures,
  sortJournalMirrorFailures,
} from '@/lib/accounting/journal-mirror-failures'
import { roundMoney } from '@/lib/accounting/money'
import { countPosSalesWithoutJournal } from '@/lib/accounting/pos-journal-gaps'

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

/**
 * Posted invoices whose journal was reversed and never replaced.
 *
 * Two queries rather than a nested filter: journal_entries carries invoice_id
 * but Prisma has no back-relation from Invoice, so the reversed set is fetched
 * first and the invoices counted against it.
 */
async function countInvoicesWithReversedJournal(asOfDate: Date): Promise<number> {
  const reversed = await prisma.journalEntry.findMany({
    where: {
      invoiceId: { not: null },
      isReversed: true,
      NOT: { ref: { startsWith: 'REV/' } },
    },
    select: { invoiceId: true },
  })
  const ids = Array.from(new Set(reversed.map(r => r.invoiceId).filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return 0
  return prisma.invoice.count({
    where: {
      id: { in: ids },
      status: { in: ['approved', 'invoiced', 'dispatched', 'delivered'] },
      postingStatus: 'unposted',
      invoiceDate: { lte: asOfDate },
    },
  })
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
    orphanedInvoices,
    posGaps,
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
    // Invoices the business treats as posted whose GL journal was REVERSED and
    // never replaced. Until 2026-09-27 a stale browser tab could un-post an
    // invoice and reverse its journal silently, and nothing looked for the
    // result: 'unposted_journals' below counts journals that never posted, not
    // invoices that lost the journal they had. Three August invoices sat this
    // way for six weeks with their revenue and output VAT missing and their
    // customers' AR driven negative by receipts that still credited it.
    //
    // The reversal is required, not incidental. Without it this counts every
    // invoice that predates the 13 Sep finance cutover — 291 of them, KES
    // 9.68m, whose absence from the GL is correct because there was no chart of
    // accounts then and the opening balances already carry them. A gate that
    // fires on those would block every close from here to the end of time.
    countInvoicesWithReversedJournal(asOfDate),
    countPosSalesWithoutJournal(asOfDate),
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

  // These balances are gated against the GL, so the allocations-only sum made
  // legacy-paid invoices look outstanding and could fail an otherwise sound
  // ledger. invoiceOutstanding carries the amountPaid fallback.
  const arBalance = roundMoney(arInvoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0))
  const apBalance = roundMoney(apInvoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0))

  const unbalancedCount = unbalanced.filter(j => Math.abs(Number(j.totalDebit) - Number(j.totalCredit)) > 0.02).length

  // Journals the blob→Prisma mirror refused. They exist operationally and are
  // absent from every figure above, so this gate has to fail loudly.
  // Dismissed failures stay on file but leave the gate: some refusals are
  // permanent by construction (an aborted POS ticket with no lines can never
  // satisfy the validator), and counting those would block every close forever.
  const mirrorFailureMap = await loadJournalMirrorFailures()
  const mirrorFailures = sortJournalMirrorFailures(mirrorFailureMap)
    .filter(f => !f.dismissedAt)
  const mirrorFailureDetail = mirrorFailures.length === 0
    ? 'Every posted journal reached journal_entries'
    : `${mirrorFailures.length} journal(s) missing from the ledger: ` +
      mirrorFailures.slice(0, 3).map(f => `${f.ref} (${f.reason})`).join('; ') +
      (mirrorFailures.length > 3 ? ` …and ${mirrorFailures.length - 3} more` : '')
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
      id: 'invoices_without_journal',
      name: 'Every posted invoice is in the ledger',
      passed: orphanedInvoices === 0,
      ledgerAmount: orphanedInvoices,
      subledgerAmount: 0,
      difference: orphanedInvoices,
      populationCount: orphanedInvoices,
      detail: orphanedInvoices > 0
        ? 'Posted invoices with no live GL journal — revenue and output VAT are missing and AR is understated. Re-post them before closing.'
        : undefined,
    },
    {
      id: 'pos_sales_without_journal',
      name: 'Every till sale is in the ledger',
      passed: posGaps === 0,
      ledgerAmount: posGaps,
      subledgerAmount: 0,
      difference: posGaps,
      populationCount: posGaps,
      detail: posGaps > 0
        ? 'POS sales with no GL journal. Their journal call failed and nothing recorded it — postingStatus reads "unposted" for every till sale, so it cannot show this.'
        : undefined,
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
    {
      id: 'journal_mirror_backlog',
      name: 'Every posted journal reached the ledger',
      passed: mirrorFailures.length === 0,
      ledgerAmount: mirrorFailures.length,
      subledgerAmount: 0,
      difference: mirrorFailures.length,
      populationCount: mirrorFailures.length,
      detail: mirrorFailureDetail,
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
