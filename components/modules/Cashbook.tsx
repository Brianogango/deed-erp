'use client'
import { useState, useMemo } from 'react'
import {
  useFinanceStore, fmtKes, fmtDate,
  CashbookEntry, BankAccount, BankStatementLine, StatementLineCategory,
  Invoice, POSOrder, Expense, PayrollRun, PurchaseOrder, POLine, Deposit,
} from '@/lib/store'
import type { Account } from '@/lib/store'
import { invoicePaymentStatus } from '@/lib/odoo-sales-flow'
import { DataTable, type ColumnDef } from '@/components/data-table'

// ── Helpers ───────────────────────────────────────────────────────────────────
export function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

export function toYM(d: string) { return d.slice(0, 7) }

function posBank(payment: 'cash' | 'mpesa' | 'card'): string {
  if (payment === 'cash')  return 'cash'
  if (payment === 'mpesa') return 'mpesa'
  return 'ncba'
}

function expenseBank(pm: string): string {
  if (pm === 'petty_cash')    return 'cash'
  if (pm === 'mpesa_company') return 'mpesa'
  return 'ncba'
}

// ── COA category lookup ───────────────────────────────────────────────────────
// Map a transaction sourceType (+ optional expense sub-category) to a COA account name.
export function getCOACategory(
  sourceType: CashbookEntry['sourceType'],
  accounts: Account[],
  expenseCategory?: string,
): string {
  switch (sourceType) {
    case 'customer_invoice':
    case 'deposit':
    case 'pos': {
      const a = accounts.find(a =>
        ['Revenue - Products', 'Revenue - Solutions', 'Revenue - Repair'].includes(a.group)
      )
      return a?.name ?? 'Sales Revenue'
    }
    case 'vendor_bill': {
      const a = accounts.find(a => a.group.startsWith('Payables'))
      return a?.name ?? 'Vendor Payment'
    }
    case 'purchase': {
      const a = accounts.find(a => a.group === 'Local Purchases')
      return a?.name ?? 'Local Purchases'
    }
    case 'payroll': {
      const a = accounts.find(a => a.group === 'Employment Expenses' && a.name.toLowerCase().includes('salar'))
      return a?.name ?? accounts.find(a => a.group === 'Employment Expenses')?.name ?? 'Salaries & Wages'
    }
    case 'expense': {
      // Map expense category keywords → COA account name
      const keywords: Record<string, string[]> = {
        transport:           ['Fuel', 'Transport'],
        accommodation:       ['Subsistence', 'Accommodation'],
        meals:               ['Subsistence', 'Accommodation'],
        courier:             ['Courier', 'Delivery'],
        stationery:          ['Printing', 'Stationery'],
        printing:            ['Printing', 'Stationery'],
        water:               ['Water', 'Electricity'],
        utilities:           ['Water', 'Electricity'],
        cleaning:            ['Water', 'Electricity'],
        office_supplies:     ['Office'],
        medical:             ['Medical'],
        training:            ['Training'],
        repairs_maintenance: ['Repairs', 'Maintenance'],
      }
      const kws = keywords[expenseCategory ?? ''] ?? []
      if (kws.length > 0) {
        const a = accounts.find(a =>
          a.group === 'Operating Expenses' &&
          kws.some(kw => a.name.toLowerCase().includes(kw.toLowerCase()))
        )
        if (a) return a.name
      }
      return accounts.find(a => a.group === 'Operating Expenses')?.name ?? 'Operating Expense'
    }
    default:
      return 'Other'
  }
}

// ── Build cashbook entries from all transaction sources ───────────────────────
export function buildCashbookEntries(
  state: {
    invoices: Invoice[]
    posOrders: POSOrder[]
    expenses: Expense[]
    payrollRuns: PayrollRun[]
    purchaseOrders: PurchaseOrder[]
    deposits: Deposit[]
  },
  accounts: Account[],
): CashbookEntry[] {
  const { invoices, posOrders, expenses, payrollRuns, purchaseOrders, deposits } = state
  const entries: CashbookEntry[] = []

  // 1. Customer invoice payments → Credit actual bank account used per receipt.
  invoices.filter(i => i.type === 'customer_invoice' && (i.payments?.length ?? 0) > 0).forEach(inv => {
    inv.payments!.forEach(payment => {
      entries.push({
        id: `inv-pay-${inv.id}-${payment.id}`,
        date: payment.date,
        ref: payment.reference || inv.ref,
        description: `Invoice payment — ${inv.partnerName}`,
        category: getCOACategory('customer_invoice', accounts),
        bankAccountId: payment.bankAccountId || posBank((payment.method === 'mpesa' || payment.method === 'card' || payment.method === 'cash') ? payment.method : 'card'),
        debit: 0,
        credit: payment.amount,
        sourceType: 'customer_invoice',
        sourceId: inv.id,
        recordedBy: payment.recordedBy || 'Finance',
      })
    })
  })

  // 2. Vendor bill payments → Debit actual bank account used per payment.
  invoices.filter(i => i.type === 'vendor_bill' && (i.payments?.length ?? 0) > 0).forEach(inv => {
    inv.payments!.forEach(payment => {
      entries.push({
        id: `bill-pay-${inv.id}-${payment.id}`,
        date: payment.date,
        ref: payment.reference || inv.ref,
        description: `Bill payment — ${inv.partnerName}`,
        category: getCOACategory('vendor_bill', accounts),
        bankAccountId: payment.bankAccountId || posBank((payment.method === 'mpesa' || payment.method === 'card' || payment.method === 'cash') ? payment.method : 'card'),
        debit: payment.amount,
        credit: 0,
        sourceType: 'vendor_bill',
        sourceId: inv.id,
        recordedBy: payment.recordedBy || 'Finance',
      })
    })
  })

  // 3. Deposit / layby receipts → Credit per payment method
  deposits.filter(d => (d.payments?.length ?? 0) > 0).forEach(dep => {
    dep.payments.forEach(payment => {
      entries.push({
        id: `dep-pay-${dep.id}-${payment.id}`,
        date: payment.date,
        ref: payment.ref || dep.ref,
        description: `Deposit receipt — ${dep.customerName}`,
        category: getCOACategory('deposit', accounts),
        bankAccountId: posBank((payment.method === 'mpesa' || payment.method === 'card' || payment.method === 'cash') ? payment.method : 'card'),
        debit: 0,
        credit: payment.amount,
        sourceType: 'deposit',
        sourceId: dep.id,
        recordedBy: payment.recordedBy || 'Finance',
      })
    })
  })

  // 4. POS orders → Credit per payment method
  posOrders.forEach(pos => {
    entries.push({
      id: `pos-${pos.id}`,
      date: pos.date,
      ref: pos.ref,
      description: `POS Sale${pos.customerName ? ` — ${pos.customerName}` : ' — Walk-in'}`,
      category: getCOACategory('pos', accounts),
      bankAccountId: posBank(pos.payment),
      debit: 0,
      credit: pos.total,
      sourceType: 'pos',
      sourceId: pos.id,
      recordedBy: pos.createdByName ?? 'Cashier',
    })
  })

  // 5. Expenses → Debit when company-paid expenses are approved, or reimbursable claims are actually reimbursed.
  expenses
    .filter(e => e.status === 'reimbursed' || (e.status === 'approved' && e.paymentMethod !== 'reimbursement'))
    .forEach(exp => {
    entries.push({
      id: `exp-${exp.id}`,
      date: exp.expenseDate,
      ref: exp.ref,
      description: exp.description,
      category: getCOACategory('expense', accounts, exp.category),
      bankAccountId: exp.paymentMethod === 'reimbursement'
        ? (exp.reimbursementBankAccount || 'ncba')
        : expenseBank(exp.paymentMethod),
      debit: exp.amount,
      credit: 0,
      sourceType: 'expense',
      sourceId: exp.id,
      recordedBy: exp.submittedByName,
    })
  })

  // 6. Posted payroll runs → Debit NCBA
  payrollRuns.filter(p => p.status === 'posted').forEach(run => {
    entries.push({
      id: `pay-${run.id}`,
      date: `${run.year}-${run.month.padStart(2, '0')}-28`,
      ref: run.ref,
      description: `Payroll ${run.month}/${run.year} — ${run.lines.length} employees`,
      category: getCOACategory('payroll', accounts),
      bankAccountId: 'ncba',
      debit: run.totalNet,
      credit: 0,
      sourceType: 'payroll',
      sourceId: run.id,
      recordedBy: 'HR System',
    })
  })

  // 7. Received purchase orders (no linked paid bill) → Debit per account line
  purchaseOrders.filter(po => po.status === 'received').forEach(po => {
    const alreadyCaptured = invoices.some(i => i.id === po.billId && invoicePaymentStatus(i) === 'paid')
    if (alreadyCaptured) return

    const hasAccountCodes = po.lines.length > 0 && po.lines.some(l => l.accountCode)
    if (hasAccountCodes) {
      const groups = new Map<string, { lines: POLine[]; accountName: string }>()
      po.lines.forEach(l => {
        const code = l.accountCode ?? 'other'
        const acct = accounts.find(a => a.code === code)
        const name = acct?.name ?? getCOACategory('purchase', accounts)
        if (!groups.has(code)) groups.set(code, { lines: [], accountName: name })
        groups.get(code)!.lines.push(l)
      })
      groups.forEach(({ lines, accountName }, code) => {
        const total = lines.reduce((s, l) => s + l.subtotal, 0)
        entries.push({
          id: `po-${po.id}-${code}`,
          date: po.date,
          ref: po.ref,
          description: `Purchase — ${po.vendorName}${groups.size > 1 ? ` [${accountName}]` : ''}`,
          category: accountName,
          bankAccountId: 'ncba',
          debit: total,
          credit: 0,
          sourceType: 'purchase',
          sourceId: po.id,
          recordedBy: 'System',
        })
      })
    } else {
      entries.push({
        id: `po-${po.id}`,
        date: po.date,
        ref: po.ref,
        description: `Purchase — ${po.vendorName}`,
        category: getCOACategory('purchase', accounts),
        bankAccountId: 'ncba',
        debit: po.total,
        credit: 0,
        sourceType: 'purchase',
        sourceId: po.id,
        recordedBy: 'System',
      })
    }
  })

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Running balance ───────────────────────────────────────────────────────────
function addRunningBalance(entries: CashbookEntry[], opening: number) {
  let bal = opening
  return entries.map(e => { bal = bal + e.credit - e.debit; return { ...e, balance: bal } })
}

// ── Category badge ────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<CashbookEntry['sourceType'], { bg: string; text: string }> = {
  customer_invoice: { bg: 'var(--success-bg)', text: 'var(--success-text)' },
  deposit:          { bg: '#E0F2FE', text: '#075985' },
  pos:              { bg: 'var(--primary-light)', text: 'var(--info-text)' },
  vendor_bill:      { bg: 'var(--danger-bg)', text: '#991B1B' },
  purchase:         { bg: 'var(--warning-bg)', text: 'var(--warning-text)' },
  payroll:          { bg: '#EDE9FE', text: '#5B21B6' },
  expense:          { bg: '#FEF9C3', text: '#713F12' },
}
function CatBadge({ label, sourceType }: { label: string; sourceType: CashbookEntry['sourceType'] }) {
  const c = TYPE_COLORS[sourceType] ?? { bg: 'var(--bg-muted)', text: 'var(--text-4)' }
  return (
    <span className="badge" style={{ background: c.bg, color: c.text }}>
      {label.length > 24 ? label.slice(0, 24) + '…' : label}
    </span>
  )
}

// ── Statement category labels ─────────────────────────────────────────────────
const STMT_CATS: { value: StatementLineCategory; label: string; color: string }[] = [
  { value: 'receipt',       label: 'Receipt',       color: 'var(--success)' },
  { value: 'payment',       label: 'Payment',       color: 'var(--danger)' },
  { value: 'bank_charge',   label: 'Bank Charge',   color: 'var(--warning)' },
  { value: 'interest_earned', label: 'Interest',    color: '#06B6D4' },
  { value: 'transfer',      label: 'Transfer',      color: '#8B5CF6' },
  { value: 'other',         label: 'Other',         color: 'var(--text-4)' },
]
function stmtCatBadge(cat: StatementLineCategory) {
  const c = STMT_CATS.find(x => x.value === cat) ?? STMT_CATS[STMT_CATS.length - 1]
  return (
    <span className="badge badge-gray text-[9px]" style={{ color: c.color }}>
      {c.label}
    </span>
  )
}

// ── Full bank reconciliation panel ────────────────────────────────────────────
function ReconPanel({
  account, cashbookEntries, month, bookBalance, savedRecon, onSave,
}: {
  account: BankAccount
  cashbookEntries: CashbookEntry[]
  month: string
  bookBalance: number
  savedRecon?: { statementBalance: number; statementDate: string; notes: string; status: string; reconciledBy?: string; reconciledAt?: string }
  onSave: (statementBalance: number, statementDate: string, notes: string, status?: 'pending' | 'reconciled' | 'discrepancy') => void
}) {
  const {
    bankStatementLines, addStatementLine, deleteStatementLine, currentUser, systemSettings,
    matchStatementLine, unmatchStatementLine, autoMatchStatements, showToast,
  } = useFinanceStore()

  // Local form state for adding a statement line
  const [form, setForm] = useState({
    date: `${month}-01`, description: '', reference: '',
    debit: '', credit: '', balance: '', category: 'payment' as StatementLineCategory,
  })
  const [pendingMatch, setPendingMatch] = useState<string | null>(null) // statementId waiting for cashbook pick
  const [subTab, setSubTab] = useState<'statement' | 'matching' | 'recon'>('statement')

  // Statement lines for this account + month
  const stmtLines = bankStatementLines.filter(
    l => l.bankAccountId === account.id && l.month === month
  ).sort((a, b) => a.date.localeCompare(b.date))

  // Matching lookup
  const matchedEntryIds = new Set(stmtLines.filter(l => l.matchedEntryId).map(l => l.matchedEntryId as string))

  const matchedPairs     = stmtLines.filter(l => l.matchedEntryId)
  const unmatchedStmt    = stmtLines.filter(l => !l.matchedEntryId)
  const unmatchedEntries = cashbookEntries.filter(e => !matchedEntryIds.has(e.id))

  // Statement-based totals
  const stmtTotalCredit = stmtLines.reduce((s, l) => s + l.credit, 0)
  const stmtTotalDebit  = stmtLines.reduce((s, l) => s + l.debit, 0)
  const stmtClosing     = stmtLines.length > 0
    ? (stmtLines[stmtLines.length - 1].balance ?? stmtTotalCredit - stmtTotalDebit)
    : null

  // Reconciliation statement figures
  const outstandingDeposits = unmatchedEntries.filter(e => e.credit > 0).reduce((s, e) => s + e.credit, 0)
  const outstandingPayments = unmatchedEntries.filter(e => e.debit  > 0).reduce((s, e) => s + e.debit,  0)
  const unrecordedCredits   = unmatchedStmt.filter(l => l.credit > 0).reduce((s, l) => s + l.credit, 0)
  const unrecordedCharges   = unmatchedStmt.filter(l => l.debit  > 0).reduce((s, l) => s + l.debit,  0)
  const bankCharges         = unmatchedStmt.filter(l => l.category === 'bank_charge').reduce((s, l) => s + l.debit, 0)

  const stmtBalance     = stmtClosing ?? savedRecon?.statementBalance ?? 0
  const adjBankBalance  = stmtBalance + outstandingDeposits - outstandingPayments
  const adjBookBalance  = bookBalance + unrecordedCredits - unrecordedCharges
  const isReconciled    = stmtLines.length > 0 && Math.abs(adjBankBalance - adjBookBalance) < 1
  const isLocked        = !!savedRecon && savedRecon.status === 'reconciled' && systemSettings.accLockDates
  const statementDate   = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10)

  function submitLine() {
    if (isLocked) { showToast('This reconciled bank period is locked. Reopen it before adding statement lines.', 'error'); return }
    const debitVal  = parseFloat(form.debit)  || 0
    const creditVal = parseFloat(form.credit) || 0
    if (!form.description) { showToast('Enter a description', 'error'); return }
    if (debitVal === 0 && creditVal === 0) { showToast('Enter a debit or credit amount', 'error'); return }
    addStatementLine({
      bankAccountId: account.id,
      month,
      date:        form.date,
      description: form.description,
      reference:   form.reference,
      debit:       debitVal,
      credit:      creditVal,
      balance:     parseFloat(form.balance) || undefined,
      category:    form.category,
    })
    setForm(p => ({ ...p, description: '', reference: '', debit: '', credit: '', balance: '' }))
  }

  function handleAutoMatch() {
    if (isLocked) { showToast('This reconciled bank period is locked. Reopen it before auto-matching.', 'error'); return }
    const count = autoMatchStatements(account.id, month, cashbookEntries)
    showToast(`Auto-matched ${count} transaction${count !== 1 ? 's' : ''}`, count > 0 ? 'success' : 'info')
  }

  const ACCT_COLOR: Record<string, string> = {
    ncba: 'var(--navy)', equity: '#0891B2', kcb: 'var(--warning)', mpesa: '#16A34A', cash: 'var(--text-4)',
  }
  const color = ACCT_COLOR[account.id] ?? 'var(--text-4)'

  return (
    <div className="card overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-lt)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: color }}>
            {account.id.toUpperCase().slice(0, 2)}
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{account.name}</p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{account.bankName} · {account.accountNo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${isLocked ? 'badge-gray' : isReconciled ? 'badge-green' : stmtLines.length > 0 ? 'badge-amber' : 'badge-gray'}`}>
            {isLocked ? 'Locked Period' : isReconciled ? '✓ Reconciled' : stmtLines.length > 0 ? '⚠ In Progress' : 'No Statement'}
          </span>
          {stmtLines.length > 0 && !isLocked && (
            <button className="btn-primary text-[10px] px-3 py-1" onClick={handleAutoMatch}>
              Auto-Match
            </button>
          )}
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="border-b" style={{ borderColor: 'var(--border-lt)' }}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-0">
        {[
          { label: 'Book Balance',     val: bookBalance,     color: 'var(--navy)' },
          { label: 'Stmt Total In',    val: stmtTotalCredit, color: 'var(--success)' },
          { label: 'Stmt Total Out',   val: stmtTotalDebit,  color: 'var(--danger)' },
          { label: 'Matched Lines',    val: matchedPairs.length, color: 'var(--success)', isCount: true },
          { label: 'Unmatched Lines',  val: unmatchedStmt.length + unmatchedEntries.length, color: unmatchedStmt.length + unmatchedEntries.length > 0 ? 'var(--warning)' : 'var(--success)', isCount: true },
        ].map(({ label, val, color, isCount }, i) => (
          <div key={label} className="p-3 text-center" style={{ borderRight: i < 4 ? '1px solid var(--border-lt)' : 'none' }}>
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-4)' }}>{label}</p>
            <p className="text-sm font-bold" style={{ color }}>
              {isCount ? val : fmtKes(val as number)}
            </p>
          </div>
        ))}
      </div>
      </div>

      {/* ── Sub tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b" style={{ borderColor: 'var(--border-lt)' }}>
        {([
          { key: 'statement', label: `Statement Lines (${stmtLines.length})` },
          { key: 'matching',  label: `Matching (${matchedPairs.length} matched)` },
          { key: 'recon',     label: 'Reconciliation Statement' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className="px-4 py-2 text-[10px] font-medium transition-all"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderBottom: subTab === t.key ? `2px solid ${color}` : '2px solid transparent',
              color: subTab === t.key ? color : 'var(--text-3)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: STATEMENT LINES
      ══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'statement' && (
        <div>
          {/* Add line form */}
          {isLocked && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
              This bank period has been reconciled and locked. Reopen it from the reconciliation statement before changing statement lines or matches.
            </div>
          )}
          <div className="px-4 py-3 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-lt)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-4)' }}>
              Add Statement Line
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: '110px 1fr 120px 90px 100px 100px 90px 80px' }}>
              <input type="date" className="form-input text-[10px]"
                value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              <input type="text" className="form-input text-[10px]" placeholder="Description / Narration"
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitLine()} />
              <input type="text" className="form-input text-[10px]" placeholder="Ref / Cheque No"
                value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} />
              <select className="form-select text-[10px]"
                value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as StatementLineCategory }))}>
                {STMT_CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="number" className="form-input text-[10px]" placeholder="Debit (out)"
                value={form.debit} onChange={e => setForm(p => ({ ...p, debit: e.target.value, credit: '' }))} />
              <input type="number" className="form-input text-[10px]" placeholder="Credit (in)"
                value={form.credit} onChange={e => setForm(p => ({ ...p, credit: e.target.value, debit: '' }))} />
              <input type="number" className="form-input text-[10px]" placeholder="Balance"
                value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))} />
              <button className="btn-primary text-[10px] py-1.5" onClick={submitLine} disabled={isLocked}>+ Add</button>
            </div>
          </div>

          {/* Statement lines table */}
          <DataTable
            tableId={`cashbook-statement-lines-${account.id}`}
            columns={[
              {
                key: 'date', label: 'Date', priority: 2, width: '90px',
                render: (line: BankStatementLine) => <span style={{ color: 'var(--text-3)' }}>{fmtDate(line.date)}</span>,
                exportValue: (line: BankStatementLine) => line.date,
              },
              {
                key: 'description', label: 'Description', priority: 1, width: '1fr',
                render: (line: BankStatementLine) => (
                  <p className="truncate text-xs" style={{ color: 'var(--text-1)' }}>{line.description}</p>
                ),
                exportValue: (line: BankStatementLine) => line.description,
              },
              {
                key: 'reference', label: 'Reference', priority: 2, width: '120px',
                render: (line: BankStatementLine) => (
                  <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{line.reference || '—'}</span>
                ),
                exportValue: (line: BankStatementLine) => line.reference || '',
              },
              {
                key: 'category', label: 'Category', priority: 3, width: '80px',
                render: (line: BankStatementLine) => stmtCatBadge(line.category),
                exportValue: (line: BankStatementLine) => line.category,
              },
              {
                key: 'debit', label: 'Debit (Out)', priority: 1, width: '110px', align: 'right',
                render: (line: BankStatementLine) => (
                  <span className="font-mono text-xs" style={{ color: line.debit > 0 ? 'var(--danger)' : 'var(--text-4)' }}>
                    {line.debit > 0 ? fmtKes(line.debit) : '—'}
                  </span>
                ),
                exportValue: (line: BankStatementLine) => line.debit || '',
              },
              {
                key: 'credit', label: 'Credit (In)', priority: 1, width: '110px', align: 'right',
                render: (line: BankStatementLine) => (
                  <span className="font-mono text-xs" style={{ color: line.credit > 0 ? 'var(--success)' : 'var(--text-4)' }}>
                    {line.credit > 0 ? fmtKes(line.credit) : '—'}
                  </span>
                ),
                exportValue: (line: BankStatementLine) => line.credit || '',
              },
              {
                key: 'balance', label: 'Balance', priority: 2, width: '100px', align: 'right',
                render: (line: BankStatementLine) => (
                  <span className="font-mono text-xs" style={{ color: 'var(--text-2)' }}>
                    {line.balance != null ? fmtKes(line.balance) : '—'}
                  </span>
                ),
                exportValue: (line: BankStatementLine) => line.balance ?? '',
              },
            ] as ColumnDef<BankStatementLine>[]}
            rows={stmtLines}
            rowKey={line => line.id}
            hideSearch
            emptyMessage={`No statement lines yet — add lines from your ${account.name} bank statement above`}
            perPage={50}
            rowStyle={line => line.matchedEntryId ? { background: 'rgba(16,185,129,0.04)' } : {}}
            rowActions={line => {
              const matchedEntry = line.matchedEntryId
                ? cashbookEntries.find(e => e.id === line.matchedEntryId)
                : null
              return (
                <div className="flex items-center gap-1.5 justify-end">
                  {matchedEntry ? (
                    <button
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: 'none' }}
                      title={`Matched: ${matchedEntry.ref} — ${matchedEntry.description}`}
                      disabled={isLocked}
                      onClick={() => unmatchStatementLine(line.id)}>
                      ✓ {matchedEntry.ref}
                    </button>
                  ) : (
                    <button
                      className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer"
                      style={{
                        background: pendingMatch === line.id ? 'var(--warning-bg)' : 'var(--bg-surface)',
                        color: pendingMatch === line.id ? 'var(--warning-text)' : 'var(--text-4)',
                        border: '1px solid var(--border)',
                      }}
                      disabled={isLocked}
                      onClick={() => setPendingMatch(p => p === line.id ? null : line.id)}>
                      {pendingMatch === line.id ? 'Cancel' : 'Match'}
                    </button>
                  )}
                  <button
                    className="text-[10px] font-semibold"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                    disabled={isLocked}
                    onClick={() => deleteStatementLine(line.id)}
                    aria-label="Delete statement line">×</button>
                </div>
              )
            }}
          />

          {/* Pending match instruction */}
          {pendingMatch && (
            <div className="mx-4 my-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid #FCD34D' }}>
              Now click a cashbook entry below to match it with the selected statement line
            </div>
          )}

          {/* Cashbook entries for manual matching */}
          {pendingMatch && (
            <div className="border-t" style={{ borderColor: 'var(--border-lt)' }}>
              <p className="px-4 pt-2 pb-1 text-[10px] uppercase font-semibold tracking-wide" style={{ color: 'var(--text-4)' }}>
                Select a cashbook entry to match
              </p>
              {cashbookEntries.filter(e => !matchedEntryIds.has(e.id)).map(e => (
                <div key={e.id} className="table-row cursor-pointer"
                  style={{ gridTemplateColumns: '90px 90px 1fr 100px 100px' }}
                  onClick={() => { if (!isLocked) { matchStatementLine(pendingMatch, e.id); setPendingMatch(null) } }}>
                  <span style={{ color: 'var(--text-3)' }}>{fmtDate(e.date)}</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--navy)' }}>{e.ref}</span>
                  <span className="truncate text-xs">{e.description}</span>
                  <span className="text-right font-mono text-xs" style={{ color: 'var(--danger)' }}>
                    {e.debit > 0 ? fmtKes(e.debit) : '—'}
                  </span>
                  <span className="text-right font-mono text-xs" style={{ color: 'var(--success)' }}>
                    {e.credit > 0 ? fmtKes(e.credit) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: MATCHING VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'matching' && (
        <div className="flex flex-col gap-0">

          {/* Matched pairs */}
          <div className="px-4 pt-3 pb-1">
            <p className="text-[10px] uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: 'var(--success)' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              Matched — {matchedPairs.length} transaction{matchedPairs.length !== 1 ? 's' : ''}
            </p>
          </div>
          {(() => {
            type MatchedRow = BankStatementLine & { entryDesc: string; entryDate: string; entryRef: string; entryBy: string }
            const matchedRows: MatchedRow[] = matchedPairs.flatMap(stmt => {
              const entry = cashbookEntries.find(e => e.id === stmt.matchedEntryId)
              if (!entry) return []
              return [{ ...stmt, entryDesc: entry.description, entryDate: entry.date, entryRef: entry.ref, entryBy: entry.recordedBy }]
            })
            return (
              <DataTable
                tableId={`cashbook-matched-${account.id}`}
                columns={[
                  {
                    key: 'stmt', label: 'Statement line', priority: 1, width: '1fr',
                    render: (stmt: MatchedRow) => (
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{stmt.description}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{fmtDate(stmt.date)} · {stmt.reference || 'no ref'}</p>
                      </div>
                    ),
                    exportValue: (stmt: MatchedRow) => stmt.description,
                  },
                  {
                    key: 'entry', label: 'Cashbook entry', priority: 1, width: '1fr',
                    render: (stmt: MatchedRow) => (
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{stmt.entryDesc}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{fmtDate(stmt.entryDate)} · {stmt.entryRef} · {stmt.entryBy}</p>
                      </div>
                    ),
                    exportValue: (stmt: MatchedRow) => stmt.entryDesc,
                  },
                  {
                    key: 'out', label: 'Amount (out)', priority: 2, width: '100px', align: 'right',
                    render: (stmt: MatchedRow) => <span className="font-mono text-xs" style={{ color: 'var(--danger)' }}>{stmt.debit > 0 ? fmtKes(stmt.debit) : '—'}</span>,
                    exportValue: (stmt: MatchedRow) => stmt.debit || '',
                  },
                  {
                    key: 'in', label: 'Amount (in)', priority: 2, width: '100px', align: 'right',
                    render: (stmt: MatchedRow) => <span className="font-mono text-xs" style={{ color: 'var(--success)' }}>{stmt.credit > 0 ? fmtKes(stmt.credit) : '—'}</span>,
                    exportValue: (stmt: MatchedRow) => stmt.credit || '',
                  },
                ] as ColumnDef<MatchedRow>[]}
                rows={matchedRows}
                rowKey={r => r.id}
                hideSearch
                emptyMessage="No matched transactions yet. Use Auto-Match or match manually in the Statement tab."
                perPage={30}
              />
            )
          })()}

          {/* Unmatched cashbook entries */}
          <div className="px-4 pt-4 pb-1 border-t mt-2" style={{ borderColor: 'var(--border-lt)' }}>
            <p className="text-[10px] uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: 'var(--warning)' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              In Books Only — Outstanding items ({unmatchedEntries.length})
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-4)' }}>
              These are in the cashbook but not yet on the bank statement (deposits in transit, unpresented cheques)
            </p>
          </div>
          <DataTable
            tableId={`cashbook-unmatched-entries-${account.id}`}
            columns={[
              { key: 'date', label: 'Date', priority: 2, width: '90px', render: (e: CashbookEntry) => <span style={{ color: 'var(--text-3)' }}>{fmtDate(e.date)}</span>, exportValue: (e: CashbookEntry) => e.date },
              { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: (e: CashbookEntry) => <span className="font-mono text-[10px]" style={{ color: 'var(--navy)' }}>{e.ref}</span>, exportValue: (e: CashbookEntry) => e.ref },
              { key: 'description', label: 'Description', priority: 1, width: '1fr', render: (e: CashbookEntry) => <span className="truncate text-xs">{e.description}</span>, exportValue: (e: CashbookEntry) => e.description },
              { key: 'category', label: 'Category', priority: 3, width: '120px', render: (e: CashbookEntry) => <CatBadge label={e.category} sourceType={e.sourceType} />, exportValue: (e: CashbookEntry) => e.category },
              { key: 'debit', label: 'Debit', priority: 1, width: '100px', align: 'right', render: (e: CashbookEntry) => <span className="font-mono text-xs" style={{ color: 'var(--danger)' }}>{e.debit > 0 ? fmtKes(e.debit) : '—'}</span>, exportValue: (e: CashbookEntry) => e.debit || '' },
              { key: 'credit', label: 'Credit', priority: 1, width: '100px', align: 'right', render: (e: CashbookEntry) => <span className="font-mono text-xs" style={{ color: 'var(--success)' }}>{e.credit > 0 ? fmtKes(e.credit) : '—'}</span>, exportValue: (e: CashbookEntry) => e.credit || '' },
            ] as ColumnDef<CashbookEntry>[]}
            rows={unmatchedEntries}
            rowKey={e => e.id}
            hideSearch
            emptyMessage="All cashbook entries are matched ✓"
            perPage={30}
          />

          {/* Unmatched statement lines */}
          <div className="px-4 pt-4 pb-1 border-t mt-2" style={{ borderColor: 'var(--border-lt)' }}>
            <p className="text-[10px] uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: 'var(--danger)' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              On Statement Only — Not in books ({unmatchedStmt.length})
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-4)' }}>
              Bank charges, interest, and transactions not yet recorded in the cashbook
            </p>
          </div>
          <DataTable
            tableId={`cashbook-unmatched-stmt-${account.id}`}
            columns={[
              { key: 'date', label: 'Date', priority: 2, width: '90px', render: (l: BankStatementLine) => <span style={{ color: 'var(--text-3)' }}>{fmtDate(l.date)}</span>, exportValue: (l: BankStatementLine) => l.date },
              { key: 'description', label: 'Description', priority: 1, width: '1fr', render: (l: BankStatementLine) => <span className="truncate text-xs">{l.description}</span>, exportValue: (l: BankStatementLine) => l.description },
              { key: 'reference', label: 'Reference', priority: 2, width: '120px', render: (l: BankStatementLine) => <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{l.reference || '—'}</span>, exportValue: (l: BankStatementLine) => l.reference || '' },
              { key: 'category', label: 'Category', priority: 3, width: '80px', render: (l: BankStatementLine) => stmtCatBadge(l.category), exportValue: (l: BankStatementLine) => l.category },
              { key: 'debit', label: 'Debit', priority: 1, width: '100px', align: 'right', render: (l: BankStatementLine) => <span className="font-mono text-xs" style={{ color: 'var(--danger)' }}>{l.debit > 0 ? fmtKes(l.debit) : '—'}</span>, exportValue: (l: BankStatementLine) => l.debit || '' },
              { key: 'credit', label: 'Credit', priority: 1, width: '100px', align: 'right', render: (l: BankStatementLine) => <span className="font-mono text-xs" style={{ color: 'var(--success)' }}>{l.credit > 0 ? fmtKes(l.credit) : '—'}</span>, exportValue: (l: BankStatementLine) => l.credit || '' },
            ] as ColumnDef<BankStatementLine>[]}
            rows={unmatchedStmt}
            rowKey={l => l.id}
            hideSearch
            emptyMessage="All statement lines are matched ✓"
            perPage={30}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: FORMAL RECONCILIATION STATEMENT
      ══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'recon' && (
        <div className="p-5 flex flex-col gap-4 max-w-2xl">
          {isLocked && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
              This reconciliation is locked because the period was saved as reconciled and lock dates are enabled in settings. Use <strong>Reopen Period</strong> only when Finance needs to correct statement lines or matching.
            </div>
          )}

          {stmtLines.length === 0 && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE', color: 'var(--info-text)' }}>
              Add statement lines first (in the Statement tab), then Auto-Match to generate the reconciliation statement.
            </div>
          )}

          {/* Company header */}
          <div className="text-center">
            <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>DEED TECHNOLOGIES LTD</p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Bank Reconciliation Statement</p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{account.name} · {monthLabel(month)}</p>
          </div>

          {/* Balance per bank statement section */}
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--navy)', borderBottom: '1px solid var(--border-lt)', paddingBottom: 4 }}>
              A — Balance per Bank Statement
            </p>
            <ReconRow label="Closing balance per bank statement" amount={stmtBalance} bold />
            {outstandingDeposits > 0 && (
              <>
                <ReconRow label="Add: Deposits in transit (in books, not on statement)" amount={0} note="+" />
                {unmatchedEntries.filter(e => e.credit > 0).map(e => (
                  <ReconRow key={e.id} label={`  ${e.ref} — ${e.description.slice(0, 50)}`} amount={e.credit} indent />
                ))}
                <ReconRow label="Total deposits in transit" amount={outstandingDeposits} />
              </>
            )}
            {outstandingPayments > 0 && (
              <>
                <ReconRow label="Less: Outstanding cheques / payments (in books, not cleared)" amount={0} note="−" />
                {unmatchedEntries.filter(e => e.debit > 0).map(e => (
                  <ReconRow key={e.id} label={`  ${e.ref} — ${e.description.slice(0, 50)}`} amount={e.debit} indent negative />
                ))}
                <ReconRow label="Total outstanding payments" amount={outstandingPayments} negative />
              </>
            )}
            <ReconRow label="Adjusted Bank Balance" amount={adjBankBalance} bold highlight />
          </div>

          {/* Balance per cash book section */}
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--success)', borderBottom: '1px solid var(--border-lt)', paddingBottom: 4 }}>
              B — Balance per Cash Book
            </p>
            <ReconRow label="Closing balance per cash book" amount={bookBalance} bold />
            {unrecordedCredits > 0 && (
              <>
                <ReconRow label="Add: Credits on statement not in books (interest, etc.)" amount={0} note="+" />
                {unmatchedStmt.filter(l => l.credit > 0).map(l => (
                  <ReconRow key={l.id} label={`  ${l.reference || l.description.slice(0, 50)}`} amount={l.credit} indent />
                ))}
                <ReconRow label="Total unrecorded credits" amount={unrecordedCredits} />
              </>
            )}
            {unrecordedCharges > 0 && (
              <>
                <ReconRow label="Less: Bank charges / debits not yet recorded in books" amount={0} note="−" />
                {unmatchedStmt.filter(l => l.debit > 0).map(l => (
                  <ReconRow key={l.id}
                    label={`  ${l.description.slice(0, 50)}${l.category === 'bank_charge' ? ' [fee]' : ''}`}
                    amount={l.debit} indent negative />
                ))}
                <ReconRow label="Total bank charges / unrecorded debits" amount={unrecordedCharges} negative />
              </>
            )}
            <ReconRow label="Adjusted Cash Book Balance" amount={adjBookBalance} bold highlight />
          </div>

          {/* Final balance check */}
          <div className="rounded-xl p-4" style={{
            background: isReconciled ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${isReconciled ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
          }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold" style={{ color: isReconciled ? 'var(--success)' : 'var(--danger)' }}>
                  {isReconciled ? '✓ RECONCILED' : '⚠ NOT RECONCILED'}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {isReconciled
                    ? 'Adjusted bank balance equals adjusted cash book balance.'
                    : 'Difference must be investigated — unmatched transactions or recording errors.'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Difference</p>
                <p className="text-base font-bold font-mono" style={{ color: isReconciled ? 'var(--success)' : 'var(--danger)' }}>
                  {fmtKes(Math.abs(adjBankBalance - adjBookBalance))}
                </p>
              </div>
            </div>
            {bankCharges > 0 && (
              <p className="text-[10px] mt-2 pt-2 border-t" style={{ color: 'var(--warning)', borderColor: 'var(--border-lt)' }}>
                ⚠ Bank charges of <strong>{fmtKes(bankCharges)}</strong> are on the statement but not yet recorded in the books.
                Post these as journal entries under "Bank Charges / Financial Expenses".
              </p>
            )}
          </div>

          {/* Save / reopen recon summary */}
          <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
            <div className="text-[10px]" style={{ color: 'var(--text-4)' }}>
              {savedRecon?.reconciledBy && (
                <span>Last saved by <strong>{savedRecon.reconciledBy}</strong> · {savedRecon.reconciledAt?.slice(0, 10)}</span>
              )}
            </div>
            {['director', 'finance_officer'].includes(currentUser?.role ?? '') && (
              <div className="flex items-center gap-2">
                {isLocked && (
                  <button
                    type="button"
                    className="btn-outline text-xs px-4 py-1.5"
                    onClick={() => onSave(
                      stmtBalance,
                      savedRecon?.statementDate || `${month}-30`,
                      savedRecon?.notes || 'Period reopened for corrections',
                      'pending',
                    )}
                  >
                    Reopen Period
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary text-xs px-4 py-1.5"
                  disabled={isLocked}
                  onClick={() => onSave(stmtBalance, `${month}-30`, `${matchedPairs.length} matched, ${unmatchedStmt.length} stmt-only, ${unmatchedEntries.length} books-only`)}
                >
                  Save Reconciliation
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reconciliation row helper ─────────────────────────────────────────────────
function ReconRow({ label, amount, bold, indent, negative, highlight, note }: {
  label: string; amount: number; bold?: boolean; indent?: boolean
  negative?: boolean; highlight?: boolean; note?: string
}) {
  if (note) {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5">
        <span className="text-[10px] flex-1" style={{ color: 'var(--text-3)', paddingLeft: indent ? 16 : 0 }}>{label}</span>
        <span className="text-[10px] font-bold w-6 text-right" style={{ color: negative ? 'var(--danger)' : 'var(--success)' }}>{note}</span>
      </div>
    )
  }
  return (
    <div className={`flex items-center justify-between px-2 py-1 rounded ${highlight ? 'my-1' : ''}`}
      style={{
        background: highlight ? 'var(--bg-surface)' : 'transparent',
        border: highlight ? '1px solid var(--border)' : 'none',
        paddingLeft: indent ? 24 : 8,
      }}>
      <span className={bold ? 'text-[11px] font-semibold text-t1' : 'text-[10px] text-t2'}>
        {label}
      </span>
      <span
        className={`font-mono ${bold ? 'text-[11px] font-semibold' : 'text-[10px]'}`}
        style={{ color: negative ? 'var(--danger)' : highlight ? 'var(--navy)' : 'var(--text-2)' }}>
        {negative ? `(${fmtKes(amount)})` : fmtKes(amount)}
      </span>
    </div>
  )
}

// ── Main Cash Book tab component ──────────────────────────────────────────────
export default function CashbookTab({ accounts }: { accounts: Account[] }) {
  const appState  = useFinanceStore()
  const { bankAccounts, bankRecons, saveBankRecon, systemSettings } = appState
  const reconEnabled = systemSettings.accReconciliation !== false

  const allEntries = useMemo(
    () => buildCashbookEntries(appState, accounts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appState.invoices, appState.posOrders, appState.expenses, appState.payrollRuns, appState.purchaseOrders, appState.deposits, accounts],
  )

  const availableMonths = useMemo(() => {
    const months = new Set(allEntries.map(e => toYM(e.date)))
    const now = new Date()
    months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    return Array.from(months).sort().reverse()
  }, [allEntries])

  const [activeMonth, setActiveMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [activeTab,    setActiveTab]    = useState<'cashbook' | 'reconcile'>('cashbook')
  const [filterAccount, setFilterAccount] = useState<string>('all')

  // Honor Settings → Accounting → Bank reconciliation toggle.
  const visibleTab = !reconEnabled && activeTab === 'reconcile' ? 'cashbook' : activeTab

  const monthEntries = useMemo(() => {
    const res: CashbookEntry[] = []
    for (const e of allEntries) {
      if (toYM(e.date) === activeMonth) res.push(e)
    }
    return res
  }, [allEntries, activeMonth])

  const filteredEntries = useMemo(() => {
    if (filterAccount === 'all') return monthEntries
    const res: CashbookEntry[] = []
    for (const e of monthEntries) {
      if (e.bankAccountId === filterAccount) res.push(e)
    }
    return res
  }, [monthEntries, filterAccount])

  // Opening balance per account = opening from bank account + all prior entries
  const openingByAccount = useMemo(() => {
    const map: Record<string, number> = {}
    for (const acc of bankAccounts) map[acc.id] = acc.openingBalance
    for (const e of allEntries) {
      if (toYM(e.date) < activeMonth && map[e.bankAccountId] !== undefined) {
        map[e.bankAccountId] += (e.credit - e.debit)
      }
    }
    return map
  }, [allEntries, activeMonth, bankAccounts])

  const viewOpening = filterAccount === 'all'
    ? Object.values(openingByAccount).reduce((s, v) => s + v, 0)
    : (openingByAccount[filterAccount] ?? 0)

  const entriesWithBal = useMemo(() => addRunningBalance(filteredEntries, viewOpening), [filteredEntries, viewOpening])

  const totalCredit  = filteredEntries.reduce((s, e) => s + e.credit, 0)
  const totalDebit   = filteredEntries.reduce((s, e) => s + e.debit,  0)
  const closingBal   = viewOpening + totalCredit - totalDebit

  const closingByAccount = useMemo(() => {
    const map: Record<string, number> = { ...openingByAccount }
    for (const e of monthEntries) {
      if (map[e.bankAccountId] !== undefined) {
        map[e.bankAccountId] += (e.credit - e.debit)
      }
    }
    return map
  }, [monthEntries, openingByAccount])

  const ACCT_COLOR: Record<string, string> = {
    ncba: 'var(--navy)', equity: '#0891B2', kcb: 'var(--warning)', mpesa: '#16A34A', cash: 'var(--text-4)',
  }

  const filterAccountName = filterAccount === 'all'
    ? 'All accounts'
    : (bankAccounts.find(a => a.id === filterAccount)?.name ?? filterAccount)

  return (
    <div className="flex flex-col gap-4 py-3">

      {/* Title + month / account selects (mobile-first; no pill strip) */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-1)' }}>Cash Book</p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Daily transactions · bank reconciliation</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>Month</span>
            <select className="form-select text-xs w-full min-h-[44px]"
              value={activeMonth} onChange={e => setActiveMonth(e.target.value)}>
              {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>Account</span>
            <select className="form-select text-xs w-full min-h-[44px]"
              value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
              <option value="all">All accounts</option>
              {bankAccounts.filter(a => a.active).map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Per-account KPI cards — desktop only; mobile uses the account select + one balance line */}
      <div className="hidden sm:grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {bankAccounts.filter(a => a.active).map(acc => {
          const closing = closingByAccount[acc.id] ?? 0
          const mCredit = monthEntries.filter(e => e.bankAccountId === acc.id).reduce((s,e) => s+e.credit, 0)
          const mDebit  = monthEntries.filter(e => e.bankAccountId === acc.id).reduce((s,e) => s+e.debit,  0)
          const color   = ACCT_COLOR[acc.id] ?? 'var(--text-4)'
          return (
            <button key={acc.id} className="stat-card text-left"
              onClick={() => { setFilterAccount(p => p === acc.id ? 'all' : acc.id); setActiveTab('cashbook') }}
              style={{ borderColor: filterAccount === acc.id ? color : undefined }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] uppercase tracking-wide font-medium truncate" style={{ color: 'var(--text-4)', maxWidth: 100 }}>{acc.name}</p>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>{acc.id.toUpperCase()}</span>
              </div>
              <p className="text-sm font-bold" style={{ color }}>{fmtKes(closing)}</p>
              <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-4)' }}>
                +{fmtKes(mCredit)} / −{fmtKes(mDebit)}
              </p>
            </button>
          )
        })}
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['cashbook', ...(reconEnabled ? ['reconcile'] as const : [])] as const).map(t => (
          <button key={t}
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium transition-all ${visibleTab === t ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(t)}>
            {t === 'cashbook' ? 'Cash Book' : 'Bank Reconciliation'}
          </button>
        ))}
      </div>

      {/* ── CASH BOOK TABLE ─────────────────────────────────────────────── */}
      {visibleTab === 'cashbook' && (
        <div className="card overflow-hidden">
          {/* Opening balance — single line on all viewports */}
          <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
            style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
            <span className="font-semibold min-w-0" style={{ color: 'var(--text-2)' }}>
              Opening — {monthLabel(activeMonth)}
              <span className="font-normal block sm:inline sm:before:content-['·_']" style={{ color: 'var(--text-3)' }}>
                {filterAccountName}
              </span>
            </span>
            <span className="font-bold font-mono shrink-0" style={{ color: 'var(--navy)' }}>{fmtKes(viewOpening)}</span>
          </div>

          <DataTable
            tableId="cashbook-entries"
            columns={[
              {
                key: 'date', label: 'Date', priority: 2, width: '90px',
                render: (e: CashbookEntry & { balance: number }) => <span className="text-t3">{fmtDate(e.date)}</span>,
                exportValue: (e: CashbookEntry & { balance: number }) => e.date,
              },
              {
                key: 'ref', label: 'Reference', priority: 1, width: '100px',
                render: (e: CashbookEntry & { balance: number }) => <span className="font-mono text-[10px] text-brand-navy">{e.ref}</span>,
                exportValue: (e: CashbookEntry & { balance: number }) => e.ref,
              },
              {
                key: 'description', label: 'Description / by', priority: 1, width: '1fr',
                render: (e: CashbookEntry & { balance: number }) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-xs">{e.description}</p>
                    <p className="text-[10px] text-t4">By {e.recordedBy}</p>
                  </div>
                ),
                accessor: (e: CashbookEntry & { balance: number }) => `${e.description} ${e.recordedBy}`,
                exportValue: (e: CashbookEntry & { balance: number }) => e.description,
              },
              {
                key: 'coa', label: 'COA account', priority: 3, width: '160px',
                render: (e: CashbookEntry & { balance: number }) => <CatBadge label={e.category} sourceType={e.sourceType} />,
                exportValue: (e: CashbookEntry & { balance: number }) => e.category,
              },
              {
                key: 'bank', label: 'Bank account', priority: 2, width: '120px',
                render: (e: CashbookEntry & { balance: number }) => {
                  const acc = bankAccounts.find(a => a.id === e.bankAccountId)
                  const color = ACCT_COLOR[e.bankAccountId] ?? 'var(--text-4)'
                  return <span className="text-[10px] font-semibold truncate" style={{ color }}>{acc?.name ?? e.bankAccountId}</span>
                },
                exportValue: (e: CashbookEntry & { balance: number }) => bankAccounts.find(a => a.id === e.bankAccountId)?.name ?? e.bankAccountId,
              },
              {
                key: 'debit', label: 'Debit (out)', priority: 1, width: '110px', align: 'right',
                render: (e: CashbookEntry & { balance: number }) => (
                  <span className={`font-mono text-xs ${e.debit > 0 ? 'text-red-500' : 'text-t4'}`}>
                    {e.debit > 0 ? fmtKes(e.debit) : '—'}
                  </span>
                ),
                exportValue: (e: CashbookEntry & { balance: number }) => e.debit || '',
              },
              {
                key: 'credit', label: 'Credit (in)', priority: 1, width: '110px', align: 'right',
                render: (e: CashbookEntry & { balance: number }) => (
                  <span className={`font-mono text-xs ${e.credit > 0 ? 'text-green-600' : 'text-t4'}`}>
                    {e.credit > 0 ? fmtKes(e.credit) : '—'}
                  </span>
                ),
                exportValue: (e: CashbookEntry & { balance: number }) => e.credit || '',
              },
              {
                key: 'balance', label: 'Balance', priority: 1, width: '110px', align: 'right',
                render: (e: CashbookEntry & { balance: number }) => (
                  <span className={`font-mono text-xs font-semibold ${e.balance < 0 ? 'text-red-500' : ''}`}>
                    {fmtKes(e.balance)}
                  </span>
                ),
                exportValue: (e: CashbookEntry & { balance: number }) => e.balance,
              },
            ] as ColumnDef<CashbookEntry & { balance: number }>[]}
            rows={entriesWithBal as (CashbookEntry & { balance: number })[]}
            rowKey={e => e.id}
            hideSearch
            emptyMessage={`No transactions for ${monthLabel(activeMonth)}${filterAccount !== 'all' ? ` in ${filterAccountName}` : ''}`}
            perPage={50}
            exportTitle="Cashbook"
            exportFilename="cashbook"
            renderCard={(e: CashbookEntry & { balance: number }) => {
              const acc = bankAccounts.find(a => a.id === e.bankAccountId)
              const bankColor = ACCT_COLOR[e.bankAccountId] ?? 'var(--text-4)'
              const amount = e.credit > 0 ? e.credit : e.debit
              const isIn = e.credit > 0
              return (
                <div
                  className="px-1 py-3"
                  style={{ borderBottom: '1px solid var(--border-lt)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono" style={{ color: 'var(--navy)' }}>{e.ref}</p>
                      <p className="text-xs font-medium truncate mt-0.5" style={{ color: 'var(--text-1)' }}>{e.description}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {fmtDate(e.date)}
                        {acc ? <> · <span style={{ color: bankColor }}>{acc.name}</span></> : null}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-xs font-semibold ${isIn ? 'text-green-600' : 'text-red-500'}`}>
                        {isIn ? '+' : '−'}{fmtKes(amount)}
                      </p>
                      <p className={`font-mono text-[10px] mt-0.5 ${e.balance < 0 ? 'text-red-500' : ''}`} style={{ color: e.balance < 0 ? undefined : 'var(--text-3)' }}>
                        Bal {fmtKes(e.balance)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            }}
          />

          {/* Footer totals */}
          <div className="px-4 py-3 flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 sm:justify-end text-xs font-semibold border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
            <span className="text-t3 sm:mr-auto font-medium">
              Closing — {entriesWithBal.length} txn
              <span className="hidden sm:inline">s</span>
            </span>
            <div className="flex items-center justify-between sm:justify-end gap-4">
              <span className="font-mono text-red-500" aria-label="Total debit">{fmtKes(totalDebit)}</span>
              <span className="font-mono text-green-600" aria-label="Total credit">{fmtKes(totalCredit)}</span>
              <span className={`font-mono font-bold ${closingBal < 0 ? 'text-red-500' : 'text-brand-navy'}`} aria-label="Closing balance">
                {fmtKes(closingBal)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── RECONCILIATION TAB ────────────────────────────────────────── */}
      {visibleTab === 'reconcile' && reconEnabled && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl px-4 py-3 text-xs"
            style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE', color: 'var(--info-text)' }}>
            <strong>How to reconcile:</strong> At month-end enter the closing balance from each bank statement.
            The system compares it against the book balance computed from all recorded transactions.
            Any difference indicates outstanding deposits, unpresented cheques, or bank charges not yet posted.
          </div>

          {bankAccounts.filter(a => a.active).map(acc => {
            const accEntries = monthEntries.filter(e => e.bankAccountId === acc.id)
            const bookBal    = closingByAccount[acc.id] ?? 0
            const saved      = bankRecons.find(r => r.bankAccountId === acc.id && r.month === activeMonth)
            return (
              <ReconPanel key={acc.id} account={acc} cashbookEntries={accEntries}
                month={activeMonth} bookBalance={bookBal} savedRecon={saved}
                onSave={(stmtBal, stmtDate, notes, statusOverride) => {
                  const diff = bookBal - stmtBal
                  saveBankRecon({
                    bankAccountId: acc.id, month: activeMonth,
                    statementBalance: stmtBal, statementDate: stmtDate, notes,
                    status: statusOverride ?? (Math.abs(diff) < 0.01 ? 'reconciled' : 'discrepancy'),
                  })
                }} />
            )
          })}

          {/* Summary table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                Reconciliation Summary — {monthLabel(activeMonth)}
              </p>
            </div>
            {(() => {
              type ReconRow = BankAccount & { bookBal: number; stmtBal: number | null; diff: number | null; reconStatus: string }
              const reconRows: ReconRow[] = bankAccounts.filter(a => a.active).map(acc => {
                const bookBal = closingByAccount[acc.id] ?? 0
                const saved = bankRecons.find(r => r.bankAccountId === acc.id && r.month === activeMonth)
                return {
                  ...acc,
                  bookBal,
                  stmtBal: saved ? saved.statementBalance : null,
                  diff: saved ? bookBal - saved.statementBalance : null,
                  reconStatus: !saved ? 'Pending' : saved.status === 'reconciled' ? 'OK' : 'Gap',
                }
              })
              return (
                <DataTable
                  tableId="cashbook-recon-summary"
                  columns={[
                    {
                      key: 'account', label: 'Account', priority: 1, width: '1fr',
                      render: (acc: ReconRow) => (
                        <div>
                          <p className="font-semibold text-xs text-t1">{acc.name}</p>
                          <p className="text-[10px] text-t3">{acc.bankName} · {acc.accountNo}</p>
                        </div>
                      ),
                      exportValue: (acc: ReconRow) => acc.name,
                    },
                    {
                      key: 'opening', label: 'Opening bal', priority: 2, width: '120px', align: 'right',
                      render: (acc: ReconRow) => <span className="font-mono text-xs text-t2">{fmtKes(openingByAccount[acc.id] ?? 0)}</span>,
                      exportValue: (acc: ReconRow) => openingByAccount[acc.id] ?? 0,
                    },
                    {
                      key: 'book', label: 'Book balance', priority: 1, width: '120px', align: 'right',
                      render: (acc: ReconRow) => <span className="font-mono text-xs font-semibold" style={{ color: ACCT_COLOR[acc.id] ?? 'var(--text-4)' }}>{fmtKes(acc.bookBal)}</span>,
                      exportValue: (acc: ReconRow) => acc.bookBal,
                    },
                    {
                      key: 'stmt', label: 'Statement bal', priority: 2, width: '120px', align: 'right',
                      render: (acc: ReconRow) => <span className="font-mono text-xs text-t2">{acc.stmtBal != null ? fmtKes(acc.stmtBal) : '—'}</span>,
                      exportValue: (acc: ReconRow) => acc.stmtBal ?? '',
                    },
                    {
                      key: 'diff', label: 'Difference', priority: 1, width: '110px', align: 'right',
                      render: (acc: ReconRow) => (
                        <span className={`font-mono text-xs font-semibold ${
                          acc.diff === null ? 'text-t4' : Math.abs(acc.diff) < 0.01 ? 'text-green-600' : 'text-red-500'
                        }`}>
                          {acc.diff === null ? '—' : fmtKes(Math.abs(acc.diff))}
                        </span>
                      ),
                      exportValue: (acc: ReconRow) => acc.diff ?? '',
                    },
                    {
                      key: 'status', label: 'Status', priority: 1, width: '80px', align: 'center',
                      render: (acc: ReconRow) => (
                        <span className={`badge ${acc.reconStatus === 'Pending' ? 'badge-gray' : acc.reconStatus === 'OK' ? 'badge-green' : 'badge-red'}`}>
                          {acc.reconStatus}
                        </span>
                      ),
                      accessor: (acc: ReconRow) => acc.reconStatus,
                      exportValue: (acc: ReconRow) => acc.reconStatus,
                    },
                  ] as ColumnDef<ReconRow>[]}
                  rows={reconRows}
                  rowKey={a => a.id}
                  hideSearch
                  emptyMessage="No active bank accounts"
                  perPage={20}
                />
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
