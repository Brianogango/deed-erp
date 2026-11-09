/**
 * Cashbook entries: every money movement (invoice and bill payments, POS
 * sales, expenses, deposits, payroll payments, booked bank charges), built
 * from the store collections. Shared by the Cashbook screen and the server
 * (dashboard cash position), so both give the same answer.
 */
import type {
  CashbookEntry, BankStatementLine, Invoice, POSOrder, Expense, JournalEntry, Deposit, Account,
} from '@/lib/store'
import { GENERAL_SALES_CODE, splitBillAmount, splitSaleAmount, unmatchedSaleLines } from '@/lib/accounting/sales-lines'

function posBank(payment: string, bankAccountId?: string): string {
  if (bankAccountId) return bankAccountId
  if (payment === 'cash')  return 'cash'
  if (payment === 'mpesa') return 'mpesa'
  // bank / card (legacy) / other bank tenders
  return 'ncba'
}

function expenseBank(pm: string): string {
  if (pm === 'petty_cash')    return 'cash'
  if (pm === 'mpesa_company') return 'mpesa'
  return 'ncba'
}

// ── COA category lookup ───────────────────────────────────────────────────────
// Map a transaction sourceType (+ optional expense sub-category) to a COA account name.
function getCOACategory(
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

/** The cashbook entry a booked bank charge / interest line becomes. */
export const bankAdjustmentEntryId = (statementLineId: string) => `bank-adj-${statementLineId}`

// ── Build cashbook entries from all transaction sources ───────────────────────
export function buildCashbookEntries(
  state: {
    invoices: Invoice[]
    posOrders: POSOrder[]
    expenses: Expense[]
    journalEntries: JournalEntry[]
    deposits: Deposit[]
    /** When given, sales show the revenue account(s) they were posted to instead of a fixed one. */
    products?: Array<{ id: string; category?: string | null }>
    /** Bank charges and interest booked from the bank reconciliation. */
    bankStatementLines?: BankStatementLine[]
  },
  accounts: Account[],
): CashbookEntry[] {
  const { invoices, posOrders, expenses, journalEntries, deposits, products } = state
  const entries: CashbookEntry[] = []
  // Each sale's money is split by product line: a line linked to a product
  // uses its sales account, a line typed by hand is read from its description.
  const productById = new Map((products ?? []).map(p => [p.id, p as any]))
  const accountName = new Map(accounts.map(a => [String(a.code), a.name]))
  const known = (code: string) => accountName.has(code)
  const saleCategory = (lines: any[], amount: number) => {
    if (!products) return null
    const parts = splitSaleAmount(amount, lines ?? [], productById, known)
      .map(p => ({ ...p, name: p.code === GENERAL_SALES_CODE ? 'Other sales' : (accountName.get(p.code) ?? 'Other sales') }))
    const names = parts.map(p => p.name)
    // Name the hand-typed lines behind "Other sales" so nobody has to guess.
    const unmatched = parts.some(p => p.code === GENERAL_SALES_CODE) ? unmatchedSaleLines(lines ?? [], productById, known) : []
    return {
      label: names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} + ${names[1]}` : `${names[0]} +${names.length - 1} more`,
      title: [
        ...parts.map(p => `${p.code} ${p.name}: KES ${Math.round(p.amount).toLocaleString('en-KE')}`),
        ...(unmatched.length ? ['', 'Other sales = lines not linked to a product line:', ...unmatched.slice(0, 6).map(d => `• ${d}`)] : []),
      ].join('\n'),
      salesLines: parts,
    }
  }
  const billCategory = (lines: any[], amount: number) => {
    if (!products) return null
    const parts = splitBillAmount(amount, lines ?? [], productById, known, code => accountName.get(code))
    const names = parts.map(p => p.name)
    return {
      label: names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} + ${names[1]}` : `${names[0]} +${names.length - 1} more`,
      title: parts.map(p => `${p.name}: KES ${Math.round(p.amount).toLocaleString('en-KE')}`).join('\n'),
      billLines: parts,
    }
  }

  // 1. Customer invoice payments → Credit actual bank account used per receipt.
  invoices.filter(i => i.type === 'customer_invoice' && (i.payments?.length ?? 0) > 0).forEach(inv => {
    inv.payments!.forEach(payment => {
      const sale = saleCategory(inv.lines ?? [], payment.amount)
      entries.push({
        id: `inv-pay-${inv.id}-${payment.id}`,
        date: payment.date,
        ref: payment.reference || inv.ref,
        description: `Invoice payment — ${inv.partnerName}`,
        category: sale?.label ?? getCOACategory('customer_invoice', accounts),
        categoryTitle: sale?.title,
        salesLines: sale?.salesLines,
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
  // Vendor-credit applications (purchase return credit notes) settle AP
  // without any cash movement, so they never belong in the cashbook.
  invoices.filter(i => i.type === 'vendor_bill' && (i.payments?.length ?? 0) > 0).forEach(inv => {
    inv.payments!.filter(payment => payment.method !== 'vendor_credit').forEach(payment => {
      // A supplier paying back a credit note is money in.
      if (payment.supplierRefund) {
        entries.push({
          id: `bill-refund-${inv.id}-${payment.id}`,
          date: payment.date,
          ref: payment.reference || inv.ref,
          description: `Supplier refund — ${inv.partnerName} (${inv.ref})`,
          category: getCOACategory('vendor_bill', accounts),
          bankAccountId: payment.bankAccountId || posBank((payment.method === 'mpesa' || payment.method === 'card' || payment.method === 'cash') ? payment.method : 'card'),
          debit: 0,
          credit: payment.amount,
          sourceType: 'vendor_bill',
          sourceId: inv.id,
          recordedBy: payment.recordedBy || 'Finance',
        })
        return
      }
      const bought = billCategory(inv.lines ?? [], payment.amount)
      entries.push({
        id: `bill-pay-${inv.id}-${payment.id}`,
        date: payment.date,
        ref: payment.reference || inv.ref,
        description: `Bill payment — ${inv.partnerName}`,
        category: bought?.label ?? getCOACategory('vendor_bill', accounts),
        categoryTitle: bought?.title,
        billLines: bought?.billLines,
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
        category: products ? 'Customer Deposits' : getCOACategory('deposit', accounts),
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
    const sale = saleCategory(pos.lines ?? [], pos.total)
    entries.push({
      id: `pos-${pos.id}`,
      date: pos.date,
      ref: pos.ref,
      description: `POS Sale${pos.customerName ? ` — ${pos.customerName}` : ' — Walk-in'}`,
      category: sale?.label ?? getCOACategory('pos', accounts),
      categoryTitle: sale?.title,
      salesLines: sale?.salesLines,
      bankAccountId: posBank(pos.payment, pos.bankAccountId),
      debit: 0,
      credit: pos.total,
      sourceType: 'pos',
      sourceId: pos.id,
      recordedBy: pos.createdByName ?? 'Cashier',
    })
  })

  // 5. Expenses → only actual company payments/reimbursements enter cashbook.
  expenses
    .filter(e => e.status === 'paid' || e.status === 'reimbursed')
    .forEach(exp => {
      const reimbursed = exp.status === 'reimbursed'
      const bankAccountId = reimbursed
        ? (exp.reimbursementBankAccount || 'ncba')
        : (exp.paymentBankAccount || expenseBank(exp.paymentMethod))
      const paymentDate = reimbursed
        ? (exp.reimbursementDate || exp.expenseDate)
        : (exp.paidDate || exp.expenseDate)
      entries.push({
        id: reimbursed ? `exp-rim-${exp.id}` : `exp-pay-${exp.id}`,
        date: paymentDate,
        ref: (reimbursed ? exp.reimbursementReference : exp.paymentReference) || exp.ref,
        description: reimbursed
          ? `Expense reimbursement — ${exp.description}`
          : `Expense payment — ${exp.description}`,
        category: getCOACategory('expense', accounts, exp.category),
        bankAccountId,
        debit: exp.amount,
        credit: 0,
        sourceType: 'expense',
        sourceId: exp.id,
        recordedBy: exp.reviewedByName || 'Finance',
      })
    })

  // 6. Bank charges / interest booked from the reconciliation (they exist
  // only on the bank statement until Finance books them).
  ;(state.bankStatementLines ?? []).filter(l => l.bookedJournalRef).forEach(l => {
    const charge = l.bookedAs !== 'interest_earned'
    entries.push({
      id: bankAdjustmentEntryId(l.id),
      date: l.date,
      ref: l.reference || l.bookedJournalRef!,
      description: `${charge ? 'Bank charges' : 'Interest earned'} — ${l.description}`,
      category: charge ? 'Bank charges' : 'Interest earned',
      bankAccountId: l.bankAccountId,
      debit: charge ? l.debit : 0,
      credit: charge ? 0 : l.credit,
      sourceType: charge ? 'bank_charge' : 'bank_interest',
      sourceId: l.id,
      recordedBy: l.bookedBy || 'Finance',
    })
  })

  // 7. Payroll → only an explicit payroll payment journal moves cash.
  journalEntries
    .filter(j => Boolean(j.payrollRunId) && j.ref.startsWith('JRN/PAYROLL-PAY/'))
    .forEach(journal => {
      entries.push({
        id: `payroll-payment-${journal.id}`,
        date: journal.date,
        ref: journal.ref,
        description: journal.description || 'Payroll payment',
        category: getCOACategory('payroll', accounts),
        bankAccountId: journal.bankAccountId || 'ncba',
        debit: journal.totalCredit,
        credit: 0,
        sourceType: 'payroll',
        sourceId: journal.payrollRunId!,
        recordedBy: 'Finance',
      })
    })

  // Purchase orders and goods receipts are deliberately excluded. They create
  // inventory/GRNI/AP accounting movements, not bank/cash movements. Supplier
  // cash leaves the business only when the vendor bill payment is registered.

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}

