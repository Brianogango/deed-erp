import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildManagementProfitAndLoss } from '@/lib/accounting/gl-reports'
import { buildBalanceSheet } from '@/lib/accounting/gl-reports'
import { buildHistoricalAgeing } from '@/lib/accounting/ageing.server'
import { buildCashFlowStatement } from '@/lib/accounting/cash-flow.server'
import { buildVatReturnFromTaxLedger } from '@/lib/accounting/vat-reports.server'
import { runIntegritySuite } from '@/lib/accounting/integrity-suite'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'

export const dynamic = 'force-dynamic'

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100
const iso = (d: Date) => d.toISOString().slice(0, 10)

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function startOfYear(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
}

function addDays(d: Date, days: number) {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(d: Date, months: number) {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  return next
}

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function monthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

function monthKey(d: Date) {
  return d.toISOString().slice(0, 7)
}

function monthLabel(d: Date) {
  return d.toLocaleDateString('en-KE', { month: 'short', timeZone: 'UTC' })
}

function percentChange(current: number, previous: number) {
  if (Math.abs(previous) < 0.01) return current === 0 ? 0 : null
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function nextMonthDue(periodEnd: Date, day: number) {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, day))
}

async function accountBalances(asOf: Date, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, number>()
  const rows = await prisma.journalEntryLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accountIds },
      journalEntry: { isPosted: true, entryDate: { lte: asOf } },
    },
    _sum: { debit: true, credit: true },
  })
  return new Map(rows.map(r => [
    String(r.accountId),
    money(Number(r._sum.debit || 0) - Number(r._sum.credit || 0)),
  ]))
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])

    const { searchParams } = new URL(request.url)
    const now = new Date()
    const asOfDate = parseDate(searchParams.get('asOf'), now)
    const dateTo = parseDate(searchParams.get('dateTo'), asOfDate)
    const dateFrom = parseDate(searchParams.get('dateFrom'), startOfYear(dateTo))
    const periodDays = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86400000) + 1)
    const previousTo = addDays(dateFrom, -1)
    const previousFrom = addDays(previousTo, -(periodDays - 1))

    const trendStart = monthStart(addMonths(dateTo, -11))
    const cashTrendStart = monthStart(addMonths(dateTo, -5))

    // Fixed calendar snapshots for the dashboard revenue strip. Invoice dates
    // are date-only business dates, so UTC boundaries avoid browser/server drift.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const yesterdayStart = addDays(todayStart, -1)
    const weekStart = addDays(todayStart, -((todayStart.getUTCDay() + 6) % 7))
    const currentMonthStart = monthStart(todayStart)
    const lastMonthStart = addMonths(currentMonthStart, -1)
    const lastMonthEnd = addDays(currentMonthStart, -1)
    const yearStart = startOfYear(todayStart)
    const revenueSnapshotStart = lastMonthStart < yearStart ? lastMonthStart : yearStart

    const [
      pl,
      previousPl,
      bs,
      ar,
      ap,
      cashFlow,
      vat,
      integrity,
      company,
      inventory,
      payroll,
      bankAccounts,
      latestStatements,
      trendLines,
      cashLines,
      revenueSnapshotInvoices,
      customerInvoices,
      vendorInvoices,
      recentJournals,
      unreconciledBankLines,
      overdueCustomerInvoices,
      overdueVendorInvoices,
    ] = await Promise.all([
      buildManagementProfitAndLoss({ dateFrom: iso(dateFrom), dateTo: iso(dateTo) }),
      buildManagementProfitAndLoss({ dateFrom: iso(previousFrom), dateTo: iso(previousTo) }),
      buildBalanceSheet({ asOf: iso(asOfDate) }),
      buildHistoricalAgeing({ kind: 'ar', asOf: iso(asOfDate) }),
      buildHistoricalAgeing({ kind: 'ap', asOf: iso(asOfDate) }),
      buildCashFlowStatement({ dateFrom: iso(dateFrom), dateTo: iso(dateTo) }),
      buildVatReturnFromTaxLedger({ dateFrom: iso(dateFrom), dateTo: iso(dateTo) }),
      runIntegritySuite(iso(asOfDate)),
      prisma.companySetting.findFirst({
        select: { companyName: true, defaultCurrency: true },
      }),
      prisma.productValuation.aggregate({
        _sum: { totalValue: true, totalQty: true },
        _count: true,
      }),
      prisma.payrollRun.findFirst({
        where: { postingStatus: 'posted', periodEnd: { lte: asOfDate } },
        orderBy: [{ periodEnd: 'desc' }, { postedAt: 'desc' }],
        select: {
          id: true,
          runReference: true,
          periodEnd: true,
          totalGross: true,
          totalPaye: true,
          totalNssf: true,
          totalShif: true,
          totalHousingLevy: true,
          totalNet: true,
        },
      }),
      prisma.bankAccount.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      prisma.bankStatement.findMany({
        where: { dateTo: { lte: asOfDate } },
        orderBy: [{ dateTo: 'desc' }, { importedAt: 'desc' }],
      }),
      prisma.journalEntryLine.findMany({
        where: {
          journalEntry: {
            isPosted: true,
            entryDate: { gte: trendStart, lte: dateTo },
          },
        },
        select: {
          debit: true,
          credit: true,
          account: {
            select: {
              code: true,
              accountType: true,
              accountGroup: true,
              subGroup: true,
            },
          },
          journalEntry: { select: { entryDate: true } },
        },
      }),
      prisma.journalEntryLine.findMany({
        where: {
          journalEntry: {
            isPosted: true,
            entryDate: { gte: cashTrendStart, lte: dateTo },
          },
          account: { code: { startsWith: '22' } },
        },
        select: {
          debit: true,
          credit: true,
          journalEntry: { select: { entryDate: true } },
        },
      }),
      prisma.invoice.findMany({
        where: {
          documentType: 'customer_invoice',
          postingStatus: 'posted',
          invoiceDate: { gte: revenueSnapshotStart, lte: todayStart },
        },
        select: {
          invoiceDate: true,
          totalAmount: true,
        },
      }),
      prisma.invoice.findMany({
        where: {
          documentType: 'customer_invoice',
          postingStatus: 'posted',
          invoiceDate: { gte: dateFrom, lte: dateTo },
        },
        select: {
          clientId: true,
          totalAmount: true,
          client: { select: { name: true } },
        },
      }),
      prisma.invoice.findMany({
        where: {
          documentType: 'vendor_bill',
          postingStatus: 'posted',
          invoiceDate: { gte: dateFrom, lte: dateTo },
        },
        select: {
          clientId: true,
          totalAmount: true,
          client: { select: { name: true } },
        },
      }),
      prisma.journalEntry.findMany({
        where: { isPosted: true, entryDate: { lte: asOfDate } },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          ref: true,
          entryDate: true,
          description: true,
          sourceType: true,
          totalDebit: true,
          createdById: true,
        },
      }),
      prisma.bankStatementLine.aggregate({
        where: {
          transactionDate: { lte: asOfDate },
          reconciliationStatus: 'unreconciled',
        },
        _count: true,
        _sum: { amount: true },
      }),
      prisma.invoice.findMany({
        where: {
          documentType: 'customer_invoice',
          postingStatus: 'posted',
          dueDate: { lt: asOfDate },
          totalAmount: { gt: 0 },
        },
        select: {
          id: true,
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
          postingStatus: 'posted',
          dueDate: { lt: asOfDate },
          totalAmount: { gt: 0 },
        },
        select: {
          id: true,
          totalAmount: true,
          paymentAllocations: {
            where: { reversedAt: null, applicationDate: { lte: asOfDate } },
            select: { amount: true },
          },
        },
      }),
    ])

    const revenueBetween = (from: Date, to: Date) => money(
      revenueSnapshotInvoices
        .filter(invoice => invoice.invoiceDate >= from && invoice.invoiceDate <= to)
        .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0),
    )
    const revenuePeriods = {
      today: revenueBetween(todayStart, todayStart),
      yesterday: revenueBetween(yesterdayStart, yesterdayStart),
      thisWeek: revenueBetween(weekStart, todayStart),
      lastMonth: revenueBetween(lastMonthStart, lastMonthEnd),
      thisYear: revenueBetween(yearStart, todayStart),
    }

    const previousGrossProfit = money(previousPl.grossProfit)
    const currentCash = money(cashFlow.closingCash)
    const operatingExpenses = money(pl.totalOperating)
    const vatPayable = money(vat.vatPayable)

    const kpis = [
      { id: 'revenue', label: 'Total Revenue', value: money(pl.totalRevenue), change: percentChange(pl.totalRevenue, previousPl.totalRevenue), tone: 'blue' },
      { id: 'grossProfit', label: 'Gross Profit', value: money(pl.grossProfit), change: percentChange(pl.grossProfit, previousGrossProfit), tone: 'cyan' },
      { id: 'netProfit', label: 'Net Profit', value: money(pl.netProfit), change: percentChange(pl.netProfit, previousPl.netProfit), tone: 'indigo' },
      { id: 'cash', label: 'Cash & Bank Balance', value: currentCash, change: null, tone: 'teal' },
      { id: 'ar', label: 'Accounts Receivable', value: money(ar.totals.balance), change: null, tone: 'emerald' },
      { id: 'ap', label: 'Accounts Payable', value: money(ap.totals.balance), change: null, tone: 'slate' },
      { id: 'vat', label: 'VAT Payable', value: vatPayable, change: null, tone: vatPayable > 0 ? 'red' : 'emerald' },
      { id: 'opex', label: 'Operating Expenses', value: operatingExpenses, change: percentChange(operatingExpenses, previousPl.totalOperating), tone: 'green' },
    ]

    const trendMap = new Map<string, { month: string; label: string; revenue: number; expenses: number; profit: number }>()
    for (let i = 0; i < 12; i++) {
      const d = addMonths(trendStart, i)
      trendMap.set(monthKey(d), { month: monthKey(d), label: monthLabel(d), revenue: 0, expenses: 0, profit: 0 })
    }
    for (const line of trendLines) {
      if (!line.account) continue
      const key = monthKey(line.journalEntry.entryDate)
      const row = trendMap.get(key)
      if (!row) continue
      const debit = Number(line.debit || 0)
      const credit = Number(line.credit || 0)
      if (line.account.accountType === 'revenue') {
        row.revenue += credit - debit
      } else if (line.account.accountType === 'expense') {
        const expense = debit - credit
        row.expenses += expense
      }
    }
    const revenueTrend = [...trendMap.values()].map(r => ({
      ...r,
      revenue: money(r.revenue),
      expenses: money(r.expenses),
      profit: money(r.revenue - r.expenses),
    }))

    const cashMap = new Map<string, { month: string; label: string; inflows: number; outflows: number; net: number }>()
    for (let i = 0; i < 6; i++) {
      const d = addMonths(cashTrendStart, i)
      cashMap.set(monthKey(d), { month: monthKey(d), label: monthLabel(d), inflows: 0, outflows: 0, net: 0 })
    }
    for (const line of cashLines) {
      const key = monthKey(line.journalEntry.entryDate)
      const row = cashMap.get(key)
      if (!row) continue
      row.inflows += Number(line.debit || 0)
      row.outflows += Number(line.credit || 0)
    }
    const cashTrend = [...cashMap.values()].map(r => ({
      ...r,
      inflows: money(r.inflows),
      outflows: money(r.outflows),
      net: money(r.inflows - r.outflows),
    }))

    const latestByBank = new Map<string, typeof latestStatements[number]>()
    for (const st of latestStatements) {
      if (!latestByBank.has(st.bankAccountId)) latestByBank.set(st.bankAccountId, st)
    }
    const payrollLiabilityCodes = [
      COA_ROLE_CODES.paye_payable,
      COA_ROLE_CODES.nssf_payable,
      COA_ROLE_CODES.shif_payable,
      COA_ROLE_CODES.housing_levy_payable,
    ]
    const payrollLiabilityAccounts = await prisma.accountCode.findMany({
      where: { code: { in: payrollLiabilityCodes } },
      select: { id: true, code: true },
    })
    const allBalanceAccountIds = [
      ...new Set([
        ...bankAccounts.map(b => b.glAccountId),
        ...payrollLiabilityAccounts.map(a => a.id),
      ]),
    ]
    const balances = await accountBalances(
      new Date(`${iso(asOfDate)}T23:59:59Z`),
      allBalanceAccountIds,
    )
    const accountIdByCode = new Map(payrollLiabilityAccounts.map(a => [a.code, a.id]))
    const liabilityBalance = (code: string) => {
      const id = accountIdByCode.get(code)
      if (!id) return 0
      return money(Math.max(0, -(balances.get(id) || 0)))
    }

    const glUsage = new Map<string, number>()
    for (const bank of bankAccounts) {
      glUsage.set(bank.glAccountId, (glUsage.get(bank.glAccountId) || 0) + 1)
    }
    const banks = bankAccounts.map(bank => {
      const statement = latestByBank.get(bank.id)
      const hasDedicatedGl = (glUsage.get(bank.glAccountId) || 0) === 1
      const bookBalance = hasDedicatedGl ? money(balances.get(bank.glAccountId) || 0) : null
      const bankBalance = statement ? money(statement.closingBalance) : null
      const variance = bankBalance == null || bookBalance == null ? null : money(bankBalance - bookBalance)
      return {
        id: bank.id,
        name: bank.name,
        currency: bank.currencyCode,
        bookBalance,
        bankBalance,
        variance,
        sharedGl: !hasDedicatedGl,
        status: statement?.status === 'reconciled'
          ? 'reconciled'
          : statement
            ? 'items_pending'
            : 'no_statement',
      }
    })

    function topPartners(rows: typeof customerInvoices) {
      const map = new Map<string, { id: string; name: string; amount: number }>()
      for (const row of rows) {
        const id = row.clientId || row.client?.name || 'unknown'
        const current = map.get(id) || { id, name: row.client?.name || 'Unknown', amount: 0 }
        current.amount += Number(row.totalAmount || 0)
        map.set(id, current)
      }
      const total = [...map.values()].reduce((sum, row) => sum + row.amount, 0)
      return [...map.values()]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(row => ({
          ...row,
          amount: money(row.amount),
          share: total > 0 ? Math.round((row.amount / total) * 1000) / 10 : 0,
        }))
    }

    const userIds = recentJournals.map(j => j.createdById).filter((id): id is string => Boolean(id))
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: [...new Set(userIds)] } },
          select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : []
    const userMap = new Map(users.map(u => [
      u.id,
      u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.username,
    ]))

    const recentTransactions = recentJournals.map(j => ({
      id: j.id,
      date: iso(j.entryDate),
      ref: j.ref,
      description: j.description || 'Journal entry',
      module: j.sourceType || 'general_ledger',
      user: j.createdById ? userMap.get(j.createdById) || 'User' : 'System',
      amount: money(j.totalDebit),
      status: 'posted',
    }))

    const inventoryValue = money(inventory._sum.totalValue || 0)
    const inventoryTurnover = inventoryValue > 0 ? Math.round((pl.totalCogs / inventoryValue) * 100) / 100 : 0
    const inventoryDays = inventoryTurnover > 0 ? Math.round(365 / inventoryTurnover) : null

    const payrollObligations = payroll ? [
      {
        id: 'paye',
        label: 'PAYE',
        period: payroll.periodEnd.toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        amount: liabilityBalance(COA_ROLE_CODES.paye_payable),
        dueDate: iso(nextMonthDue(payroll.periodEnd, 9)),
        status: liabilityBalance(COA_ROLE_CODES.paye_payable) > 0.01 ? 'due' : 'settled',
      },
      {
        id: 'nssf',
        label: 'NSSF',
        period: payroll.periodEnd.toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        amount: liabilityBalance(COA_ROLE_CODES.nssf_payable),
        dueDate: iso(nextMonthDue(payroll.periodEnd, 15)),
        status: liabilityBalance(COA_ROLE_CODES.nssf_payable) > 0.01 ? 'due' : 'settled',
      },
      {
        id: 'shif',
        label: 'SHIF',
        period: payroll.periodEnd.toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        amount: liabilityBalance(COA_ROLE_CODES.shif_payable),
        dueDate: iso(nextMonthDue(payroll.periodEnd, 9)),
        status: liabilityBalance(COA_ROLE_CODES.shif_payable) > 0.01 ? 'due' : 'settled',
      },
      {
        id: 'housing',
        label: 'Housing Levy',
        period: payroll.periodEnd.toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        amount: liabilityBalance(COA_ROLE_CODES.housing_levy_payable),
        dueDate: iso(nextMonthDue(payroll.periodEnd, 9)),
        status: liabilityBalance(COA_ROLE_CODES.housing_levy_payable) > 0.01 ? 'due' : 'settled',
      },
    ] : []

    const overdueCustomer = overdueCustomerInvoices
      .map(inv => money(Number(inv.totalAmount) - inv.paymentAllocations.reduce((s, a) => s + Number(a.amount || 0), 0)))
      .filter(v => v > 0.01)
    const overdueVendor = overdueVendorInvoices
      .map(inv => money(Number(inv.totalAmount) - inv.paymentAllocations.reduce((s, a) => s + Number(a.amount || 0), 0)))
      .filter(v => v > 0.01)

    const failedIntegrity = integrity.gates.filter(g => !g.passed)
    const alerts = [
      {
        id: 'overdue-ar',
        severity: overdueCustomer.length ? 'danger' : 'ok',
        label: `${overdueCustomer.length} overdue customer invoice${overdueCustomer.length === 1 ? '' : 's'}`,
        amount: money(overdueCustomer.reduce((s, v) => s + v, 0)),
        target: 'invoices',
      },
      {
        id: 'bank-unreconciled',
        severity: unreconciledBankLines._count ? 'danger' : 'ok',
        label: `${unreconciledBankLines._count} unreconciled bank item${unreconciledBankLines._count === 1 ? '' : 's'}`,
        amount: money(Math.abs(Number(unreconciledBankLines._sum.amount || 0))),
        target: 'cashbook',
      },
      {
        id: 'overdue-ap',
        severity: overdueVendor.length ? 'warning' : 'ok',
        label: `${overdueVendor.length} overdue vendor bill${overdueVendor.length === 1 ? '' : 's'}`,
        amount: money(overdueVendor.reduce((s, v) => s + v, 0)),
        target: 'bills',
      },
      {
        id: 'integrity',
        severity: failedIntegrity.length ? 'danger' : 'ok',
        label: `${failedIntegrity.length} finance integrity exception${failedIntegrity.length === 1 ? '' : 's'}`,
        amount: null,
        target: 'integrity',
      },
    ]

    const checklistIds = ['tb_balanced', 'ar_vs_gl', 'ap_vs_gl', 'inventory_vs_gl', 'vat_vs_tax_txns', 'fiscal_period']
    const checklist = checklistIds.map(id => {
      const gate = integrity.gates.find(g => g.id === id)
      return {
        id,
        label: gate?.name || id,
        status: gate?.passed ? 'done' : 'attention',
        detail: gate?.detail || null,
      }
    })
    const checklistDone = checklist.filter(x => x.status === 'done').length

    return NextResponse.json({
      meta: {
        companyName: company?.companyName || 'Deed Technologies Ltd',
        currency: company?.defaultCurrency || 'KES',
        dateFrom: iso(dateFrom),
        dateTo: iso(dateTo),
        asOf: iso(asOfDate),
        generatedAt: new Date().toISOString(),
      },
      kpis,
      revenuePeriods,
      revenueTrend,
      cashTrend,
      ageing: {
        ar: ar.totals,
        ap: ap.totals,
      },
      banks,
      budget: {
        configured: false,
        rows: [
          { id: 'revenue', label: 'Revenue', budget: null, actual: money(pl.totalRevenue) },
          { id: 'grossProfit', label: 'Gross Profit', budget: null, actual: money(pl.grossProfit) },
          { id: 'operatingExpenses', label: 'Operating Expenses', budget: null, actual: money(pl.totalOperating) },
          { id: 'netProfit', label: 'Net Profit', budget: null, actual: money(pl.netProfit) },
        ],
      },
      tax: {
        outputVat: money(vat.outputVat),
        inputVat: money(vat.inputVat),
        vatPayable,
        withholdingVat: money(vat.withholdingVat || 0),
        etimsPending: Number(vat.pendingTransmissionCount || 0),
        etimsLinked: Number(vat.etimsLinkedCount || 0),
        glDifference: vat.glDifference == null ? null : money(vat.glDifference),
      },
      profitLoss: {
        revenue: money(pl.totalRevenue),
        otherIncome: money(pl.totalOtherIncome),
        costOfSales: money(pl.totalCogs),
        grossProfit: money(pl.grossProfit),
        operatingExpenses: money(pl.totalOperating),
        operatingProfit: money(pl.grossProfit - pl.totalOperating),
        financeCosts: money(pl.totalFinance),
        netProfit: money(pl.netProfit),
      },
      balanceSheet: {
        totalAssets: money(bs.totalAssets),
        currentAssets: money(bs.assets.filter(a => /cash|receiv|inventory|prepayment/i.test(`${a.group} ${a.name}`)).reduce((s, a) => s + a.amount, 0)),
        nonCurrentAssets: money(bs.totalAssets - bs.assets.filter(a => /cash|receiv|inventory|prepayment/i.test(`${a.group} ${a.name}`)).reduce((s, a) => s + a.amount, 0)),
        totalLiabilities: money(bs.totalLiabilities),
        currentLiabilities: money(bs.liabilities.filter(a => !/non-current/i.test(`${a.group} ${a.name}`)).reduce((s, a) => s + a.amount, 0)),
        nonCurrentLiabilities: money(bs.liabilities.filter(a => /non-current/i.test(`${a.group} ${a.name}`)).reduce((s, a) => s + a.amount, 0)),
        equity: money(bs.totalEquity),
        balanced: bs.balanced,
      },
      payroll: {
        runReference: payroll?.runReference || null,
        totalGross: money(payroll?.totalGross || 0),
        totalNet: money(payroll?.totalNet || 0),
        obligations: payrollObligations,
      },
      inventory: {
        closingValue: inventoryValue,
        totalQty: Number(inventory._sum.totalQty || 0),
        productCount: inventory._count,
        cogs: money(pl.totalCogs),
        turnover: inventoryTurnover,
        days: inventoryDays,
      },
      topCustomers: topPartners(customerInvoices),
      topVendors: topPartners(vendorInvoices),
      recentTransactions,
      integrity: {
        passedCount: integrity.passedCount,
        failedCount: integrity.failedCount,
        allPassed: integrity.allPassed,
        total: integrity.gates.length,
      },
      checklist: {
        completed: checklistDone,
        total: checklist.length,
        items: checklist,
      },
      alerts,
      cashFlow: {
        inflows: money(cashTrend.reduce((s, x) => s + x.inflows, 0)),
        outflows: money(cashTrend.reduce((s, x) => s + x.outflows, 0)),
        netChange: money(cashFlow.netChange),
        openingCash: money(cashFlow.openingCash),
        closingCash: money(cashFlow.closingCash),
      },
    })
  })
}
