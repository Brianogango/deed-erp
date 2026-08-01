// Finance exception + cash-position helpers, shared by the central dashboard
// (Needs Attention band, cash KPIs) and the Accounting module's reports.
// Extracted from the Accounting module's former in-page workflow-alert strip
// so the logic exists exactly once.

import { invoiceDocState } from '@/lib/odoo-sales-flow'

export interface FinanceAlert {
  key: string
  tone: 'danger' | 'warn' | 'info'
  title: string
  sub: string
  /** Route that opens the screen where the exception is resolved. */
  path: string
}

type InvoiceLike = { type?: string; status?: string; total?: number; amountPaid?: number; dueDate?: string; date?: string }
type ExpenseLike = { reimbursable?: boolean; status?: string; reimbursementStatus?: string; amount?: number }
type PayrollLike = { status?: string }
type StatementLineLike = { status?: string }
type BankAccountLike = { id: string; name: string; active?: boolean; openingBalance?: number }
type CashbookEntryLike = { bankAccountId: string; debit: number; credit: number }

const openBalance = (i: InvoiceLike) => Math.max(0, (Number(i.total) || 0) - (Number(i.amountPaid) || 0))
// Open = posted document with a residual; payment progress is derived from
// amountPaid, never from the stored status.
const isOpen = (i: InvoiceLike) => invoiceDocState(i.status) === 'posted' && openBalance(i) > 0
const isPastDue = (i: InvoiceLike, today: Date) =>
  isOpen(i) && new Date(i.dueDate || i.date || 0) < today

/** Running balance per bank/cash account: opening balance + cashbook activity. */
export function computeCashbookTotals(
  bankAccounts: BankAccountLike[],
  entries: CashbookEntryLike[],
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const acc of bankAccounts) totals[acc.id] = Number(acc.openingBalance) || 0
  for (const e of entries) {
    if (totals[e.bankAccountId] !== undefined) totals[e.bankAccountId] += e.credit - e.debit
  }
  return totals
}

/** Cash at Bank = NCBA + Equity + KCB; Cash in Hand = Petty Cash + M-Pesa. */
export function cashPositionFromTotals(totals: Record<string, number>): { cashAtBank: number; cashInHand: number } {
  return {
    cashAtBank: (totals['ncba'] ?? 0) + (totals['equity'] ?? 0) + (totals['kcb'] ?? 0),
    cashInHand: (totals['cash'] ?? 0) + (totals['mpesa'] ?? 0),
  }
}

const fmtKes = (n: number) => `KSh ${Math.round(n).toLocaleString('en-KE')}`

/**
 * Finance exceptions needing action, most severe first: collections, payables,
 * reimbursements, payroll approvals, reconciliation backlog, and negative cash.
 */
export function buildFinanceAlerts(data: {
  invoices: InvoiceLike[]
  expenses: ExpenseLike[]
  payrollRuns: PayrollLike[]
  bankStatementLines: StatementLineLike[]
  bankAccounts: BankAccountLike[]
  cashbookTotals: Record<string, number>
}): FinanceAlert[] {
  const { invoices, expenses, payrollRuns, bankStatementLines, bankAccounts, cashbookTotals } = data

  const today = new Date()
  const customerInvoices = invoices.filter(i => i.type === 'customer_invoice')
  const vendorBills = invoices.filter(i => i.type === 'vendor_bill')
  const overdueInvoices = customerInvoices.filter(i => isPastDue(i, today))
  const overdueBills = vendorBills.filter(i => isPastDue(i, today))
  const pendingBills = vendorBills.filter(i => isOpen(i))
  const pendingReimbursements = expenses.filter(e => e.reimbursable && e.status === 'approved' && e.reimbursementStatus !== 'reimbursed')
  const pendingPayroll = payrollRuns.filter(p => p.status === 'pending_approval')
  const unreconciledLines = bankStatementLines.filter(l => l.status !== 'reconciled')
  const negativeCashAccounts = bankAccounts.filter(a => a.active && (cashbookTotals[a.id] ?? (Number(a.openingBalance) || 0)) < 0)

  const alerts: (FinanceAlert | null)[] = [
    overdueInvoices.length ? {
      key: 'fin-overdue-invoices', tone: 'danger',
      title: `${overdueInvoices.length} overdue customer invoice${overdueInvoices.length > 1 ? 's' : ''}`,
      sub: `${fmtKes(overdueInvoices.reduce((s, i) => s + openBalance(i), 0))} needs collection`,
      path: '/finance?tab=reports&report=ageing',
    } : null,
    negativeCashAccounts.length ? {
      key: 'fin-negative-cash', tone: 'danger',
      title: `${negativeCashAccounts.length} cash account${negativeCashAccounts.length > 1 ? 's' : ''} negative`,
      sub: negativeCashAccounts.map(a => a.name).join(', '),
      path: '/finance?tab=cash_position',
    } : null,
    overdueBills.length ? {
      key: 'fin-overdue-bills', tone: 'warn',
      title: `${overdueBills.length} overdue supplier bill${overdueBills.length > 1 ? 's' : ''}`,
      sub: `${fmtKes(overdueBills.reduce((s, i) => s + openBalance(i), 0))} payables past due`,
      path: '/finance?tab=reports&report=ageing',
    } : null,
    pendingReimbursements.length ? {
      key: 'fin-reimbursements', tone: 'warn',
      title: `${pendingReimbursements.length} staff reimbursement${pendingReimbursements.length > 1 ? 's' : ''} due`,
      sub: `${fmtKes(pendingReimbursements.reduce((s, e) => s + (Number(e.amount) || 0), 0))} approved, not yet paid`,
      path: '/finance?tab=cashbook',
    } : null,
    pendingPayroll.length ? {
      key: 'fin-payroll', tone: 'warn',
      title: `${pendingPayroll.length} payroll run${pendingPayroll.length > 1 ? 's' : ''} awaiting approval`,
      sub: 'Review payroll before payment posting',
      path: '/hr?tab=payroll',
    } : null,
    pendingBills.length ? {
      key: 'fin-open-bills', tone: 'info',
      title: `${pendingBills.length} open supplier bill${pendingBills.length > 1 ? 's' : ''}`,
      sub: `${fmtKes(pendingBills.reduce((s, i) => s + openBalance(i), 0))} awaiting payment`,
      path: '/finance?tab=bills',
    } : null,
    unreconciledLines.length ? {
      key: 'fin-unreconciled', tone: 'info',
      title: `${unreconciledLines.length} unreconciled bank line${unreconciledLines.length > 1 ? 's' : ''}`,
      sub: 'Match statement lines before month-end close',
      path: '/finance?tab=cashbook',
    } : null,
  ]
  return alerts.filter(Boolean) as FinanceAlert[]
}
