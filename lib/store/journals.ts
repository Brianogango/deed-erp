import { now, uid } from './ids'
import { type JournalEntryLine, type JournalEntry, type Invoice, type VendorJournalOpts } from './finance'
import { type PpeJournalDraft } from '@/lib/accounting/ppe-journals'
import { isPpeCostAccount } from '@/lib/company-property-ppe'
import { type Expense } from './expenses'
import { aggregateLinesByAccount, formatAccountLabel, COMPANY_ACCOUNT_FALLBACKS, type AccountableProduct } from '@/lib/product-accounts'
import { inferProductKind } from '@/lib/product-kind'
import { buildVendorBillPerpetualLines, buildVendorCreditPerpetualLines } from '@/lib/accounting/vendor-bill-perpetual'
import { paymentJournalRef } from '@/lib/finance-controls'
import { expenseAccountForCategory } from '@/lib/accounting/expense-pos-accounts'

/** Journal entries the store posts for invoices, bills, payments, expenses and credits. */

export const isoDate = (date?: string) => {
  const source = date || now()
  return source.includes('T') ? source : new Date(`${source}T00:00:00`).toISOString()
}

export const accountLine = (account: string, description: string, debit = 0, credit = 0): JournalEntryLine => ({
  id: uid(),
  account,
  description,
  debit: Math.round(debit * 100) / 100,
  credit: Math.round(credit * 100) / 100,
})

export function journalFromPpeDraft(draft: PpeJournalDraft): JournalEntry {
  const lines = draft.lines.map(l => accountLine(l.account, l.description, l.debit, l.credit))
  return {
    id: uid(),
    ref: draft.ref,
    date: draft.date,
    source: 'adjustment',
    description: draft.description,
    status: 'posted',
    lines,
    totalDebit: draft.totalDebit,
    totalCredit: draft.totalCredit,
  }
}

export function ppeAccountCodeFromLine(accountCode?: string): string | undefined {
  const code = String(accountCode || '').trim()
  return isPpeCostAccount(code) ? code : undefined
}

export const bankAccountLabel = (bankAccountId?: string, method?: string) => {
  const id = bankAccountId || (method === 'mpesa' || method === 'mpesa_company' ? 'mpesa' : method === 'cash' || method === 'petty_cash' ? 'cash' : 'ncba')
  // Keep the client-side mirror on the same canonical CoA codes as the
  // server posting engine. 2210/2203 are legacy cashbook labels and may not
  // exist in the strict relational CoA.
  if (id === 'mpesa' || id === 'cash') return '2211 - Petty Cash / Mobile Money'
  if (id === 'equity') return '2202 - Equity Bank'
  return '2201 - ABSA Bank'
}

export const bankAccountIdForMethod = (method?: string, bankAccountId?: string) => {
  if (bankAccountId) return bankAccountId
  if (method === 'mpesa' || method === 'mpesa_company') return 'mpesa'
  if (method === 'cash' || method === 'petty_cash') return 'cash'
  // bank / bank_transfer / card (legacy POS) → default NCBA when no bank chosen
  return 'ncba'
}

/** Bill / vendor credit lines as the perpetual-inventory journal builders expect them. */
export const vendorJournalLineInputs = (
  doc: Invoice,
  resolveProduct: ((productId: string) => AccountableProduct | undefined) | undefined,
  opts: VendorJournalOpts,
  absolute = false,
) => doc.lines.map(l => {
  const product = l.productId ? resolveProduct?.(l.productId) as any : undefined
  const kind = inferProductKind({
    productKind: product?.productKind,
    category: product?.category,
    unit: product?.unit,
    trackingMethod: product?.trackingMethod,
    requiresSerial: product?.requiresSerial,
  })
  const amount = (v: unknown) => absolute ? Math.abs(Number(v) || 0) : Number(v) || 0
  const poLine = opts.poLines?.find(p => p.productId && l.productId && p.productId === l.productId)
  const ppeAccountCode = ppeAccountCodeFromLine(l.accountCode)
  return {
    productId: l.productId,
    qty: amount(l.qty),
    unitPrice: amount(l.unitPrice),
    subtotal: amount(l.subtotal),
    accountCode: l.accountCode,
    ppeAccountCode,
    isStocked: !ppeAccountCode && (kind === 'storable' || kind === 'consumable'),
    receiptUnitCost: Math.max(0, Number(poLine?.unitPrice ?? l.unitPrice) || 0),
  }
})

export const buildInvoicePostingJournal = (
  inv: Invoice,
  resolveProduct?: (productId: string) => AccountableProduct | undefined,
  chartAccounts: Array<{ code: string; name: string }> = [],
  opts: VendorJournalOpts = {},
): JournalEntry => {
  if (inv.type === 'customer_invoice') {
    const revenueBuckets = aggregateLinesByAccount({
      lines: inv.lines.map(l => ({
        productId: l.productId,
        subtotal: l.subtotal,
        accountCode: l.accountCode,
        lineType: l.lineType,
      })),
      resolveProduct,
      side: 'revenue',
      accounts: chartAccounts,
    })
    const revenueLines = revenueBuckets.length
      ? revenueBuckets.map(b => accountLine(b.account, `Revenue: ${inv.ref}`, 0, b.amount))
      : [accountLine(formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, chartAccounts), `Revenue: ${inv.ref}`, 0, inv.subtotal)]
    const lines = [
      accountLine('1800 - Accounts Receivable', `AR: ${inv.partnerName}`, inv.total, 0),
      ...revenueLines,
      ...(inv.taxTotal > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${inv.ref}`, 0, inv.taxTotal)] : []),
    ]
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
    return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'invoice', description: `Invoice ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit, totalCredit }
  }

  const perpetual = Boolean(opts.perpetual && inv.purchaseOrderId)
  const vendorLines = buildVendorBillPerpetualLines({
    partnerName: inv.partnerName,
    ref: inv.ref,
    subtotal: inv.subtotal,
    taxTotal: inv.taxTotal,
    total: inv.total,
    perpetual,
    chartAccounts,
    lines: vendorJournalLineInputs(inv, resolveProduct, opts),
  })
  const lines = vendorLines.map(l => accountLine(l.account, l.description, l.debit, l.credit))
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'bill', description: `Bill ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit, totalCredit }
}

// Vendor credit note (purchase return) — under perpetual inventory credits GRNI
// (paired with stock valuation Dr GRNI / Cr Inventory) instead of purchase expense.
export const buildVendorCreditJournal = (
  credit: Invoice,
  resolveProduct?: (productId: string) => AccountableProduct | undefined,
  chartAccounts: Array<{ code: string; name: string }> = [],
  opts: VendorJournalOpts = {},
): JournalEntry => {
  const perpetual = Boolean(opts.perpetual && credit.purchaseOrderId)
  const vendorLines = buildVendorCreditPerpetualLines({
    partnerName: credit.partnerName,
    ref: credit.ref,
    subtotal: credit.subtotal,
    taxTotal: credit.taxTotal,
    total: credit.total,
    perpetual,
    chartAccounts,
    lines: vendorJournalLineInputs(credit, resolveProduct, opts, true),
  })
  const lines = vendorLines.map(l => accountLine(l.account, l.description, l.debit, l.credit))
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  return { id: uid(), ref: `JRN/${credit.ref}`, date: now(), source: 'bill', description: `Vendor credit ${credit.ref} — ${credit.partnerName}`, status: 'posted', invoiceId: credit.id, lines, totalDebit, totalCredit }
}

export const buildInvoicePaymentJournal = (
  inv: Invoice,
  amount: number,
  method?: string,
  bankAccountId?: string,
  paymentDate?: string,
  paymentId?: string,
  /** Account the receipt is debited to instead of a bank (paid to rider: rider-fee expense). */
  debitAccountLabel?: string,
): JournalEntry => {
  const actualBankId = debitAccountLabel ? undefined : bankAccountIdForMethod(method, bankAccountId)
  const bankAccount = debitAccountLabel ?? bankAccountLabel(actualBankId, method)
  const isVendorPayment = inv.type === 'vendor_bill'
  const lines = isVendorPayment
    ? [
        accountLine('3000 - Accounts Payable', `AP settlement: ${inv.partnerName}`, amount, 0),
        accountLine(bankAccount, `Payment out: ${inv.ref}`, 0, amount),
      ]
    : [
        accountLine(bankAccount, `Received from ${inv.partnerName}`, amount, 0),
        accountLine('1800 - Accounts Receivable', `AR settlement: ${inv.ref}`, 0, amount),
      ]
  return {
    id: uid(),
    ref: paymentId ? paymentJournalRef(inv.ref, paymentId) : `JRN/PAY/${inv.ref}/${uid()}`,
    date: isoDate(paymentDate),
    source: isVendorPayment ? 'purchase_payment' : 'payment',
    description: `Payment for ${inv.ref} — ${inv.partnerName}`,
    status: 'posted',
    invoiceId: inv.id,
    bankAccountId: actualBankId,
    lines,
    totalDebit: amount,
    totalCredit: amount,
  }
}

// buildDepositPaymentJournal was removed. It built a client-side copy of the
// deposit receipt journal keyed on a truncated payment id, while
// lib/accounting/deposit-service.ts posts the same receipt as
// JRN/DEP/<ref>/<full payment id>. The refs never matched, so the mirror could
// not recognise them as the same entry and every deposit receipt was posted to
// the ledger twice. The server copy is the correct one.

export const buildExpenseApprovalJournal = (expense: Expense): JournalEntry => {
  const isReimbursement = expense.paymentMethod === 'reimbursement'
  const liability = isReimbursement
    ? '3312 - Employee Reimbursements Payable'
    : '3202 - Outstanding Payments'
  const lines = [
    accountLine(expenseAccountForCategory(expense.category), `${expense.ref}: ${expense.description}`, expense.amount, 0),
    accountLine(
      liability,
      isReimbursement
        ? `Reimbursement payable: ${expense.submittedByName}`
        : `Approved company expense payable: ${expense.ref}`,
      0,
      expense.amount,
    ),
  ]
  return {
    id: uid(),
    ref: `JRN/EXP/${expense.ref}`,
    date: isoDate(expense.expenseDate),
    source: 'expense',
    description: `Expense approval — ${expense.ref}`,
    status: 'posted',
    expenseId: expense.id,
    lines,
    totalDebit: expense.amount,
    totalCredit: expense.amount,
  }
}

export const buildExpenseCompanyPaymentJournal = (
  expense: Expense,
  bankAccountId?: string,
  method?: string,
  paymentDate?: string,
): JournalEntry => {
  const actualBankId = bankAccountIdForMethod(method || expense.paymentMethod, bankAccountId)
  const lines = [
    accountLine('3202 - Outstanding Payments', `Settle approved expense: ${expense.ref}`, expense.amount, 0),
    accountLine(bankAccountLabel(actualBankId, method), `Cash paid for ${expense.ref}`, 0, expense.amount),
  ]
  return {
    id: uid(),
    ref: `JRN/EXPPAY/${expense.ref}`,
    date: isoDate(paymentDate || now()),
    source: 'expense',
    description: `Expense payment — ${expense.ref}`,
    status: 'posted',
    expenseId: expense.id,
    bankAccountId: actualBankId,
    lines,
    totalDebit: expense.amount,
    totalCredit: expense.amount,
  }
}

export const buildExpenseReimbursementJournal = (expense: Expense, bankAccountId?: string, paymentDate?: string): JournalEntry => {
  const actualBankId = bankAccountIdForMethod('bank_transfer', bankAccountId)
  const lines = [
    accountLine('3312 - Employee Reimbursements Payable', `Settle reimbursement: ${expense.submittedByName}`, expense.amount, 0),
    accountLine(bankAccountLabel(actualBankId), `Cash paid for ${expense.ref}`, 0, expense.amount),
  ]
  return {
    id: uid(),
    ref: `JRN/RIM/${expense.ref}`,
    date: isoDate(paymentDate || now()),
    source: 'expense',
    description: `Expense reimbursement — ${expense.ref}`,
    status: 'posted',
    expenseId: expense.id,
    bankAccountId: actualBankId,
    lines,
    totalDebit: expense.amount,
    totalCredit: expense.amount,
  }
}

export const buildReversalJournal = (original: JournalEntry, documentRef: string, reason = 'Document cancelled'): JournalEntry => {
  const lines = original.lines.map(line => accountLine(line.account, `Reversal of ${original.ref}: ${line.description}`, line.credit, line.debit))
  return {
    ...original,
    id: uid(),
    ref: `REV/${original.ref}`,
    date: now(),
    source: 'manual',
    description: `${reason} — reversal of ${original.description} (${documentRef})`,
    lines,
    totalDebit: original.totalCredit,
    totalCredit: original.totalDebit,
  }
}

export const buildCustomerCreditJournal = (inv: Invoice, creditRef: string, amount: number): JournalEntry => {
  const subtotalRatio = inv.total > 0 ? inv.subtotal / inv.total : 1
  const taxRatio = inv.total > 0 ? inv.taxTotal / inv.total : 0
  const revenueReversal = Math.round(amount * subtotalRatio * 100) / 100
  const vatReversal = Math.round(amount * taxRatio * 100) / 100
  const lines = [
    accountLine('5000 - Sales Revenue', `Credit note ${creditRef}: reverse ${inv.ref}`, revenueReversal, 0),
    ...(vatReversal > 0 ? [accountLine('3301 - Output VAT Payable', `Credit VAT ${creditRef}`, vatReversal, 0)] : []),
    accountLine('3313 - Customer Credits', `Customer credit: ${inv.partnerName}`, 0, amount),
  ]
  return {
    id: uid(),
    ref: `JRN/${creditRef}`,
    date: now(),
    source: 'manual',
    description: `Credit note ${creditRef} for cancelled paid invoice ${inv.ref}`,
    status: 'posted',
    invoiceId: inv.id,
    lines,
    totalDebit: amount,
    totalCredit: amount,
  }
}
