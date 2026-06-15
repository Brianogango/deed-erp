'use client'
import { useState, useMemo } from 'react'
import {
  useApp, fmtKes, fmtDate,
  CashbookEntry, BankAccount, BankStatementLine, StatementLineCategory,
  Invoice, POSOrder, Expense, PayrollRun, PurchaseOrder, POLine, Deposit,
} from '@/lib/store'
import type { Account } from '@/lib/store'

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
    const alreadyCaptured = invoices.some(i => i.id === po.billId && i.status === 'paid')
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
  customer_invoice: { bg: '#DCFCE7', text: '#166534' },
  deposit:          { bg: '#E0F2FE', text: '#075985' },
  pos:              { bg: '#DBEAFE', text: '#1E40AF' },
  vendor_bill:      { bg: '#FEE2E2', text: '#991B1B' },
  purchase:         { bg: '#FEF3C7', text: 'var(--warning)' },
  payroll:          { bg: '#EDE9FE', text: '#5B21B6' },
  expense:          { bg: '#FEF9C3', text: '#713F12' },
}
function CatBadge({ label, sourceType }: { label: string; sourceType: CashbookEntry['sourceType'] }) {
  const c = TYPE_COLORS[sourceType] ?? { bg: '#F3F4F6', text: '#6B7280' }
  return (
    <span className="badge" style={{ background: c.bg, color: c.text }}>
      {label.length > 24 ? label.slice(0, 24) + '…' : label}
    </span>
  )
}

// ── Statement category labels ─────────────────────────────────────────────────
const STMT_CATS: { value: StatementLineCategory; label: string; color: string }[] = [
  { value: 'receipt',       label: 'Receipt',       color: '#10B981' },
  { value: 'payment',       label: 'Payment',       color: '#EF4444' },
  { value: 'bank_charge',   label: 'Bank Charge',   color: '#F59E0B' },
  { value: 'interest_earned', label: 'Interest',    color: '#06B6D4' },
  { value: 'transfer',      label: 'Transfer',      color: '#8B5CF6' },
  { value: 'other',         label: 'Other',         color: '#6B7280' },
]
function stmtCatBadge(cat: StatementLineCategory) {
  const c = STMT_CATS.find(x => x.value === cat) ?? STMT_CATS[STMT_CATS.length - 1]
  return (
    <span className="badge badge-gray text-9" style={{ color: c.color }}>
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
  } = useApp()

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
    ncba: 'var(--ink-navy)', equity: '#0891B2', kcb: '#D97706', mpesa: '#16A34A', cash: '#6B7280',
  }
  const color = ACCT_COLOR[account.id] ?? '#6B7280'

  return (
    <div className="card overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-lt)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-10 font-bold" style={{ background: color }}>
            {account.id.toUpperCase().slice(0, 2)}
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{account.name}</p>
            <p className="text-10" style={{ color: 'var(--text-3)' }}>{account.bankName} · {account.accountNo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${isLocked ? 'badge-gray' : isReconciled ? 'badge-green' : stmtLines.length > 0 ? 'badge-amber' : 'badge-gray'}`}>
            {isLocked ? 'Locked Period' : isReconciled ? '✓ Reconciled' : stmtLines.length > 0 ? '⚠ In Progress' : 'No Statement'}
          </span>
          {stmtLines.length > 0 && !isLocked && (
            <button className="btn-primary text-10 px-3 py-1" onClick={handleAutoMatch}>
              Auto-Match
            </button>
          )}
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-0 border-b" style={{ borderColor: 'var(--border-lt)' }}>
        {[
          { label: 'Book Balance',     val: bookBalance,     color: 'var(--ink-navy)' },
          { label: 'Stmt Total In',    val: stmtTotalCredit, color: '#10B981' },
          { label: 'Stmt Total Out',   val: stmtTotalDebit,  color: '#EF4444' },
          { label: 'Matched Lines',    val: matchedPairs.length, color: '#10B981', isCount: true },
          { label: 'Unmatched Lines',  val: unmatchedStmt.length + unmatchedEntries.length, color: unmatchedStmt.length + unmatchedEntries.length > 0 ? '#F59E0B' : '#10B981', isCount: true },
        ].map(({ label, val, color, isCount }, i) => (
          <div key={label} className="p-3 text-center" style={{ borderRight: i < 4 ? '1px solid var(--border-lt)' : 'none' }}>
            <p className="text-9 uppercase tracking-wide mb-1" style={{ color: 'var(--text-4)' }}>{label}</p>
            <p className="text-sm font-bold" style={{ color }}>
              {isCount ? val : fmtKes(val as number)}
            </p>
          </div>
        ))}
      </div>

      {/* ── Sub tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b" style={{ borderColor: 'var(--border-lt)' }}>
        {([
          { key: 'statement', label: `Statement Lines (${stmtLines.length})` },
          { key: 'matching',  label: `Matching (${matchedPairs.length} matched)` },
          { key: 'recon',     label: 'Reconciliation Statement' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className="px-4 py-2 text-10 font-medium transition-all"
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
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}>
              This bank period has been reconciled and locked. Reopen it from the reconciliation statement before changing statement lines or matches.
            </div>
          )}
          <div className="px-4 py-3 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-lt)' }}>
            <p className="text-10 font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-4)' }}>
              Add Statement Line
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: '110px 1fr 120px 90px 100px 100px 90px 80px' }}>
              <input type="date" className="form-input text-10"
                value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              <input type="text" className="form-input text-10" placeholder="Description / Narration"
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitLine()} />
              <input type="text" className="form-input text-10" placeholder="Ref / Cheque No"
                value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} />
              <select className="form-select text-10"
                value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as StatementLineCategory }))}>
                {STMT_CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="number" className="form-input text-10" placeholder="Debit (out)"
                value={form.debit} onChange={e => setForm(p => ({ ...p, debit: e.target.value, credit: '' }))} />
              <input type="number" className="form-input text-10" placeholder="Credit (in)"
                value={form.credit} onChange={e => setForm(p => ({ ...p, credit: e.target.value, debit: '' }))} />
              <input type="number" className="form-input text-10" placeholder="Balance"
                value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))} />
              <button className="btn-primary text-10 py-1.5" onClick={submitLine} disabled={isLocked}>+ Add</button>
            </div>
          </div>

          {/* Statement lines table */}
          <div className="table-head" style={{ gridTemplateColumns: '90px 1fr 120px 80px 110px 110px 100px 80px 50px' }}>
            <span>Date</span><span>Description</span><span>Reference</span><span>Category</span>
            <span className="text-right">Debit (Out)</span><span className="text-right">Credit (In)</span>
            <span className="text-right">Balance</span><span>Match</span><span>Del</span>
          </div>
          {stmtLines.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--text-4)' }}>
              No statement lines yet — add lines from your {account.name} bank statement above
            </div>
          ) : stmtLines.map(line => {
            const matchedEntry = line.matchedEntryId ? cashbookEntries.find(e => e.id === line.matchedEntryId) : null
            return (
              <div key={line.id} className="table-row"
                style={{
                  gridTemplateColumns: '90px 1fr 120px 80px 110px 110px 100px 80px 50px',
                  background: line.matchedEntryId ? 'rgba(16,185,129,0.04)' : undefined,
                }}>
                <span style={{ color: 'var(--text-3)' }}>{fmtDate(line.date)}</span>
                <div className="min-w-0">
                  <p className="truncate text-xs" style={{ color: 'var(--text-1)' }}>{line.description}</p>
                </div>
                <span className="font-mono text-10" style={{ color: 'var(--text-3)' }}>{line.reference || '—'}</span>
                {stmtCatBadge(line.category)}
                <span className="text-right font-mono text-xs" style={{ color: line.debit > 0 ? '#EF4444' : 'var(--text-4)' }}>
                  {line.debit > 0 ? fmtKes(line.debit) : '—'}
                </span>
                <span className="text-right font-mono text-xs" style={{ color: line.credit > 0 ? '#10B981' : 'var(--text-4)' }}>
                  {line.credit > 0 ? fmtKes(line.credit) : '—'}
                </span>
                <span className="text-right font-mono text-xs" style={{ color: 'var(--text-2)' }}>
                  {line.balance != null ? fmtKes(line.balance) : '—'}
                </span>
                <div>
                  {matchedEntry ? (
                    <button
                      className="text-9 font-medium px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', border: 'none' }}
                      title={`Matched: ${matchedEntry.ref} — ${matchedEntry.description}`}
                      disabled={isLocked}
                      onClick={() => unmatchStatementLine(line.id)}>
                      ✓ {matchedEntry.ref}
                    </button>
                  ) : (
                    <button
                      className="text-9 px-1.5 py-0.5 rounded cursor-pointer"
                      style={{
                        background: pendingMatch === line.id ? '#FEF3C7' : 'var(--bg-surface)',
                        color: pendingMatch === line.id ? 'var(--warning)' : 'var(--text-4)',
                        border: '1px solid var(--border)',
                      }}
                      disabled={isLocked}
                      onClick={() => setPendingMatch(p => p === line.id ? null : line.id)}>
                      {pendingMatch === line.id ? 'Cancel' : 'Match'}
                    </button>
                  )}
                </div>
                <button
                  className="text-10 font-semibold"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}
                  disabled={isLocked}
                  onClick={() => deleteStatementLine(line.id)}>×</button>
              </div>
            )
          })}

          {/* Pending match instruction */}
          {pendingMatch && (
            <div className="mx-4 my-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: '#FEF3C7', color: 'var(--warning)', border: '1px solid #FCD34D' }}>
              Now click a cashbook entry below to match it with the selected statement line
            </div>
          )}

          {/* Cashbook entries for manual matching */}
          {pendingMatch && (
            <div className="border-t" style={{ borderColor: 'var(--border-lt)' }}>
              <p className="px-4 pt-2 pb-1 text-10 uppercase font-semibold tracking-wide" style={{ color: 'var(--text-4)' }}>
                Select a cashbook entry to match
              </p>
              {cashbookEntries.filter(e => !matchedEntryIds.has(e.id)).map(e => (
                <div key={e.id} className="table-row cursor-pointer"
                  style={{ gridTemplateColumns: '90px 90px 1fr 100px 100px' }}
                  onClick={() => { if (!isLocked) { matchStatementLine(pendingMatch, e.id); setPendingMatch(null) } }}>
                  <span style={{ color: 'var(--text-3)' }}>{fmtDate(e.date)}</span>
                  <span className="font-mono text-10" style={{ color: 'var(--ink-navy)' }}>{e.ref}</span>
                  <span className="truncate text-xs">{e.description}</span>
                  <span className="text-right font-mono text-xs" style={{ color: '#EF4444' }}>
                    {e.debit > 0 ? fmtKes(e.debit) : '—'}
                  </span>
                  <span className="text-right font-mono text-xs" style={{ color: '#10B981' }}>
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
            <p className="text-10 uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: '#10B981' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              Matched — {matchedPairs.length} transaction{matchedPairs.length !== 1 ? 's' : ''}
            </p>
          </div>
          {matchedPairs.length === 0 ? (
            <p className="px-4 py-2 text-xs" style={{ color: 'var(--text-4)' }}>No matched transactions yet. Use Auto-Match or match manually in the Statement tab.</p>
          ) : (
            <>
              <div className="table-head" style={{ gridTemplateColumns: '1fr 1fr 100px 100px' }}>
                <span>Statement Line</span><span>Cashbook Entry</span>
                <span className="text-right">Amount (Out)</span><span className="text-right">Amount (In)</span>
              </div>
              {matchedPairs.map(stmt => {
                const entry = cashbookEntries.find(e => e.id === stmt.matchedEntryId)
                if (!entry) return null
                return (
                  <div key={stmt.id} className="table-row items-start"
                    style={{ gridTemplateColumns: '1fr 1fr 100px 100px', background: 'rgba(16,185,129,0.03)' }}>
                    <div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{stmt.description}</p>
                      <p className="text-10" style={{ color: 'var(--text-3)' }}>{fmtDate(stmt.date)} · {stmt.reference || 'no ref'} · {stmtCatBadge(stmt.category)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{entry.description}</p>
                      <p className="text-10" style={{ color: 'var(--text-3)' }}>{fmtDate(entry.date)} · {entry.ref} · {entry.recordedBy}</p>
                    </div>
                    <span className="text-right font-mono text-xs" style={{ color: '#EF4444' }}>
                      {stmt.debit > 0 ? fmtKes(stmt.debit) : '—'}
                    </span>
                    <span className="text-right font-mono text-xs" style={{ color: '#10B981' }}>
                      {stmt.credit > 0 ? fmtKes(stmt.credit) : '—'}
                    </span>
                  </div>
                )
              })}
            </>
          )}

          {/* Unmatched cashbook entries */}
          <div className="px-4 pt-4 pb-1 border-t mt-2" style={{ borderColor: 'var(--border-lt)' }}>
            <p className="text-10 uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: '#F59E0B' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              In Books Only — Outstanding items ({unmatchedEntries.length})
            </p>
            <p className="text-10 mt-0.5" style={{ color: 'var(--text-4)' }}>
              These are in the cashbook but not yet on the bank statement (deposits in transit, unpresented cheques)
            </p>
          </div>
          {unmatchedEntries.length === 0 ? (
            <p className="px-4 py-2 text-xs" style={{ color: 'var(--text-4)' }}>All cashbook entries are matched ✓</p>
          ) : (
            <>
              <div className="table-head" style={{ gridTemplateColumns: '90px 100px 1fr 120px 100px 100px' }}>
                <span>Date</span><span>Ref</span><span>Description</span><span>Category</span>
                <span className="text-right">Debit</span><span className="text-right">Credit</span>
              </div>
              {unmatchedEntries.map(e => (
                <div key={e.id} className="table-row" style={{ gridTemplateColumns: '90px 100px 1fr 120px 100px 100px' }}>
                  <span style={{ color: 'var(--text-3)' }}>{fmtDate(e.date)}</span>
                  <span className="font-mono text-10" style={{ color: 'var(--ink-navy)' }}>{e.ref}</span>
                  <span className="truncate text-xs">{e.description}</span>
                  <CatBadge label={e.category} sourceType={e.sourceType} />
                  <span className="text-right font-mono text-xs" style={{ color: '#EF4444' }}>
                    {e.debit > 0 ? fmtKes(e.debit) : '—'}
                  </span>
                  <span className="text-right font-mono text-xs" style={{ color: '#10B981' }}>
                    {e.credit > 0 ? fmtKes(e.credit) : '—'}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Unmatched statement lines */}
          <div className="px-4 pt-4 pb-1 border-t mt-2" style={{ borderColor: 'var(--border-lt)' }}>
            <p className="text-10 uppercase font-semibold tracking-wide flex items-center gap-2" style={{ color: '#EF4444' }}>
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              On Statement Only — Not in books ({unmatchedStmt.length})
            </p>
            <p className="text-10 mt-0.5" style={{ color: 'var(--text-4)' }}>
              Bank charges, interest, and transactions not yet recorded in the cashbook
            </p>
          </div>
          {unmatchedStmt.length === 0 ? (
            <p className="px-4 py-2 text-xs" style={{ color: 'var(--text-4)' }}>All statement lines are matched ✓</p>
          ) : (
            <>
              <div className="table-head" style={{ gridTemplateColumns: '90px 1fr 120px 80px 100px 100px' }}>
                <span>Date</span><span>Description</span><span>Reference</span><span>Category</span>
                <span className="text-right">Debit</span><span className="text-right">Credit</span>
              </div>
              {unmatchedStmt.map(l => (
                <div key={l.id} className="table-row" style={{ gridTemplateColumns: '90px 1fr 120px 80px 100px 100px' }}>
                  <span style={{ color: 'var(--text-3)' }}>{fmtDate(l.date)}</span>
                  <span className="truncate text-xs">{l.description}</span>
                  <span className="font-mono text-10" style={{ color: 'var(--text-3)' }}>{l.reference || '—'}</span>
                  {stmtCatBadge(l.category)}
                  <span className="text-right font-mono text-xs" style={{ color: '#EF4444' }}>
                    {l.debit > 0 ? fmtKes(l.debit) : '—'}
                  </span>
                  <span className="text-right font-mono text-xs" style={{ color: '#10B981' }}>
                    {l.credit > 0 ? fmtKes(l.credit) : '—'}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: FORMAL RECONCILIATION STATEMENT
      ══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'recon' && (
        <div className="p-5 flex flex-col gap-4 max-w-2xl">
          {isLocked && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: '#F3F4F6', border: '1px solid #D1D5DB', color: '#374151' }}>
              This reconciliation is locked because the period was saved as reconciled and lock dates are enabled in settings. Use <strong>Reopen Period</strong> only when Finance needs to correct statement lines or matching.
            </div>
          )}

          {stmtLines.length === 0 && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
              Add statement lines first (in the Statement tab), then Auto-Match to generate the reconciliation statement.
            </div>
          )}

          {/* Company header */}
          <div className="text-center">
            <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>DEED TECHNOLOGIES LTD</p>
            <p className="text-10" style={{ color: 'var(--text-3)' }}>Bank Reconciliation Statement</p>
            <p className="text-10" style={{ color: 'var(--text-3)' }}>{account.name} · {monthLabel(month)}</p>
          </div>

          {/* Balance per bank statement section */}
          <div>
            <p className="text-10 uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--ink-navy)', borderBottom: '1px solid var(--border-lt)', paddingBottom: 4 }}>
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
            <p className="text-10 uppercase font-bold tracking-wider mb-2" style={{ color: '#059669', borderBottom: '1px solid var(--border-lt)', paddingBottom: 4 }}>
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
                <p className="text-xs font-bold" style={{ color: isReconciled ? '#10B981' : '#EF4444' }}>
                  {isReconciled ? '✓ RECONCILED' : '⚠ NOT RECONCILED'}
                </p>
                <p className="text-10 mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {isReconciled
                    ? 'Adjusted bank balance equals adjusted cash book balance.'
                    : 'Difference must be investigated — unmatched transactions or recording errors.'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-10" style={{ color: 'var(--text-3)' }}>Difference</p>
                <p className="text-base font-bold font-mono" style={{ color: isReconciled ? '#10B981' : '#EF4444' }}>
                  {fmtKes(Math.abs(adjBankBalance - adjBookBalance))}
                </p>
              </div>
            </div>
            {bankCharges > 0 && (
              <p className="text-10 mt-2 pt-2 border-t" style={{ color: '#F59E0B', borderColor: 'var(--border-lt)' }}>
                ⚠ Bank charges of <strong>{fmtKes(bankCharges)}</strong> are on the statement but not yet recorded in the books.
                Post these as journal entries under "Bank Charges / Financial Expenses".
              </p>
            )}
          </div>

          {/* Save recon summary */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-10" style={{ color: 'var(--text-4)' }}>
              {savedRecon?.reconciledBy && (
                <span>Last saved by <strong>{savedRecon.reconciledBy}</strong> · {savedRecon.reconciledAt?.slice(0, 10)}</span>
              )}
            </div>
        {['director', 'finance_officer'].includes(currentUser?.role ?? '') && (
          <button className="btn-primary text-xs px-4 py-1.5"
            onClick={() => onSave(stmtBalance, `${month}-30`, `${matchedPairs.length} matched, ${unmatchedStmt.length} stmt-only, ${unmatchedEntries.length} books-only`)}>
            Save Reconciliation
          </button>
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
        <span className="text-10 flex-1" style={{ color: 'var(--text-3)', paddingLeft: indent ? 16 : 0 }}>{label}</span>
        <span className="text-10 font-bold w-6 text-right" style={{ color: negative ? '#EF4444' : '#10B981' }}>{note}</span>
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
      <span className={bold ? 'text-11 font-semibold text-t1' : 'text-10 text-t2'}>
        {label}
      </span>
      <span
        className={`font-mono ${bold ? 'text-11 font-semibold' : 'text-10'}`}
        style={{ color: negative ? '#EF4444' : highlight ? 'var(--ink-navy)' : 'var(--text-2)' }}>
        {negative ? `(${fmtKes(amount)})` : fmtKes(amount)}
      </span>
    </div>
  )
}

// ── Main Cash Book tab component ──────────────────────────────────────────────
export default function CashbookTab({ accounts }: { accounts: Account[] }) {
  const appState  = useApp()
  const { bankAccounts, bankRecons, saveBankRecon } = appState

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
    ncba: 'var(--ink-navy)', equity: '#0891B2', kcb: '#D97706', mpesa: '#16A34A', cash: '#6B7280',
  }

  return (
    <div className="flex flex-col gap-4 py-3">

      {/* Month selector + filter pills row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-1)' }}>Cash Book</p>
          <p className="text-10" style={{ color: 'var(--text-3)' }}>Daily transactions · bank reconciliation</p>
        </div>
        <select className="form-select text-xs ml-auto" style={{ width: 200 }}
          value={activeMonth} onChange={e => setActiveMonth(e.target.value)}>
          {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {/* Per-account KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {bankAccounts.filter(a => a.active).map(acc => {
          const closing = closingByAccount[acc.id] ?? 0
          const mCredit = monthEntries.filter(e => e.bankAccountId === acc.id).reduce((s,e) => s+e.credit, 0)
          const mDebit  = monthEntries.filter(e => e.bankAccountId === acc.id).reduce((s,e) => s+e.debit,  0)
          const color   = ACCT_COLOR[acc.id] ?? '#6B7280'
          return (
            <button key={acc.id} className="stat-card text-left"
              onClick={() => { setFilterAccount(p => p === acc.id ? 'all' : acc.id); setActiveTab('cashbook') }}
              style={{ borderColor: filterAccount === acc.id ? color : undefined }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-9 uppercase tracking-wide font-medium truncate" style={{ color: 'var(--text-4)', maxWidth: 100 }}>{acc.name}</p>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>{acc.id.toUpperCase()}</span>
              </div>
              <p className="text-sm font-bold" style={{ color }}>{fmtKes(closing)}</p>
              <p className="text-9 mt-0.5" style={{ color: 'var(--text-4)' }}>
                +{fmtKes(mCredit)} / −{fmtKes(mDebit)}
              </p>
            </button>
          )
        })}
      </div>

      {/* Tab + account filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['cashbook', 'reconcile'] as const).map(t => (
          <button key={t}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === t ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(t)}>
            {t === 'cashbook' ? 'Cash Book' : 'Bank Reconciliation'}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          {[{ id: 'all', name: 'All Accounts' }, ...bankAccounts].map(acc => (
            <button key={acc.id} onClick={() => setFilterAccount(acc.id)}
              className="px-2.5 py-1 rounded-full text-10 font-medium transition-all"
              style={{
                background: filterAccount === acc.id
                  ? (acc.id === 'all' ? 'var(--ink-navy)' : ACCT_COLOR[acc.id] ?? 'var(--ink-navy)')
                  : 'var(--bg-surface)',
                color: filterAccount === acc.id ? '#fff' : 'var(--text-3)',
                border: '1px solid var(--border)',
              }}>
              {acc.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── CASH BOOK TABLE ─────────────────────────────────────────────── */}
      {activeTab === 'cashbook' && (
        <div className="card overflow-hidden">
          {/* Opening balance */}
          <div className="px-4 py-2 flex items-center justify-between text-xs"
            style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
              Opening Balance — {monthLabel(activeMonth)}
              {filterAccount !== 'all' && ` (${bankAccounts.find(a => a.id === filterAccount)?.name})`}
            </span>
            <span className="font-bold font-mono" style={{ color: 'var(--ink-navy)' }}>{fmtKes(viewOpening)}</span>
          </div>

          <div className="overflow-x-auto">
            <div style={{ minWidth: 860 }}>
              <div className="table-head" style={{ gridTemplateColumns: '90px 100px 1fr 160px 120px 110px 110px 110px' }}>
                <span>Date</span><span>Reference</span><span>Description / By</span>
                <span>COA Account</span><span>Bank Account</span>
                <span className="text-right">Debit (Out)</span>
                <span className="text-right">Credit (In)</span>
                <span className="text-right">Balance</span>
              </div>

              <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                {entriesWithBal.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-t4">
                    No transactions for {monthLabel(activeMonth)}
                    {filterAccount !== 'all' ? ` in ${bankAccounts.find(a=>a.id===filterAccount)?.name}` : ''}
                  </div>
                ) : entriesWithBal.map(e => {
                  const acc   = bankAccounts.find(a => a.id === e.bankAccountId)
                  const color = ACCT_COLOR[e.bankAccountId] ?? '#6B7280'
                  const bal   = (e as typeof e & { balance: number }).balance
                  return (
                    <div key={e.id} className="table-row"
                      style={{ gridTemplateColumns: '90px 100px 1fr 160px 120px 110px 110px 110px' }}>
                      <span className="text-t3">{fmtDate(e.date)}</span>
                      <span className="font-mono text-10 text-brand-navy">{e.ref}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-xs">{e.description}</p>
                        <p className="text-10 text-t4">By {e.recordedBy}</p>
                      </div>
                      <CatBadge label={e.category} sourceType={e.sourceType} />
                      <span className="text-10 font-semibold truncate" style={{ color }}>
                        {acc?.name ?? e.bankAccountId}
                      </span>
                      <span className={`text-right font-mono text-xs ${e.debit > 0 ? 'text-red-500' : 'text-t4'}`}>
                        {e.debit > 0 ? fmtKes(e.debit) : '—'}
                      </span>
                      <span className={`text-right font-mono text-xs ${e.credit > 0 ? 'text-green-600' : 'text-t4'}`}>
                        {e.credit > 0 ? fmtKes(e.credit) : '—'}
                      </span>
                      <span className={`text-right font-mono text-xs font-semibold ${bal < 0 ? 'text-red-500' : ''}`}>
                        {fmtKes(bal)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Footer totals */}
              <div className="px-4 py-2.5 grid text-xs font-semibold border-t-2 border-[var(--border)] bg-[var(--bg-surface)]"
                style={{ gridTemplateColumns: '90px 100px 1fr 160px 120px 110px 110px 110px' }}>
                <span className="text-t3" style={{ gridColumn: 'span 5' }}>
                  Closing Balance — {entriesWithBal.length} transactions
                </span>
                <span className="text-right font-mono text-red-500">{fmtKes(totalDebit)}</span>
                <span className="text-right font-mono text-green-600">{fmtKes(totalCredit)}</span>
                <span className={`text-right font-mono font-bold ${closingBal < 0 ? 'text-red-500' : 'text-brand-navy'}`}>
                  {fmtKes(closingBal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RECONCILIATION TAB ────────────────────────────────────────── */}
      {activeTab === 'reconcile' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl px-4 py-3 text-xs"
            style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
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
            <div className="overflow-x-auto">
              <div style={{ minWidth: 680 }}>
                <div className="table-head" style={{ gridTemplateColumns: '1fr 120px 120px 120px 110px 80px' }}>
                  <span>Account</span>
                  <span className="text-right">Opening Bal</span>
                  <span className="text-right">Book Balance</span>
                  <span className="text-right">Statement Bal</span>
                  <span className="text-right">Difference</span>
                  <span className="text-center">Status</span>
                </div>
                {bankAccounts.filter(a => a.active).map(acc => {
                  const bookBal = closingByAccount[acc.id] ?? 0
                  const saved   = bankRecons.find(r => r.bankAccountId === acc.id && r.month === activeMonth)
                  const diff    = saved ? bookBal - saved.statementBalance : null
                  const color   = ACCT_COLOR[acc.id] ?? '#6B7280'
                  return (
                    <div key={acc.id} className="table-row"
                      style={{ gridTemplateColumns: '1fr 120px 120px 120px 110px 80px' }}>
                      <div>
                        <p className="font-semibold text-xs text-t1">{acc.name}</p>
                        <p className="text-10 text-t3">{acc.bankName} · {acc.accountNo}</p>
                      </div>
                      <span className="text-right font-mono text-xs text-t2">
                        {fmtKes(openingByAccount[acc.id] ?? 0)}
                      </span>
                      <span className="text-right font-mono text-xs font-semibold" style={{ color }}>
                        {fmtKes(bookBal)}
                      </span>
                      <span className="text-right font-mono text-xs text-t2">
                        {saved ? fmtKes(saved.statementBalance) : '—'}
                      </span>
                      <span className={`text-right font-mono text-xs font-semibold ${
                        diff === null ? 'text-t4' : Math.abs(diff) < 0.01 ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {diff === null ? '—' : fmtKes(Math.abs(diff))}
                      </span>
                      <div className="flex justify-center">
                        <span className={`badge ${!saved ? 'badge-gray' : saved.status === 'reconciled' ? 'badge-green' : 'badge-red'}`}>
                          {!saved ? 'Pending' : saved.status === 'reconciled' ? 'OK' : 'Gap'}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {/* Grand total */}
                <div className="px-4 py-2.5 grid text-xs font-bold border-t-2 border-[var(--border)] bg-[var(--bg-surface)]"
                  style={{ gridTemplateColumns: '1fr 120px 120px 120px 110px 80px' }}>
                  <span className="text-t2">Total (all accounts)</span>
                  <span className="text-right font-mono text-t2">
                    {fmtKes(bankAccounts.reduce((s, a) => s + (openingByAccount[a.id] ?? 0), 0))}
                  </span>
                  <span className="text-right font-mono text-brand-navy">
                    {fmtKes(Object.values(closingByAccount).reduce((s, v) => s + v, 0))}
                  </span>
                  <span className="text-right font-mono text-t2">
                    {fmtKes(bankRecons
                      .filter(r => r.month === activeMonth && bankAccounts.some(a => a.id === r.bankAccountId))
                      .reduce((s, r) => s + r.statementBalance, 0))}
                  </span>
                  <span /><span />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
