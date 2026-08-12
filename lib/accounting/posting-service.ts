/**
 * Accounting posting engine (Finance Phase 1).
 *
 * Single choke-point for balanced, fiscal-locked, idempotent journal commits.
 * Account codes resolve via CoA roles (map — do not renumber).
 *
 * Behind ACCOUNTING_POSTING_ENGINE (see posting-flag.ts). When disabled, callers
 * keep using invoice-journals → persistStoreJournalEntry directly.
 */

import 'server-only'
import { persistStoreJournalEntry, reverseJournalEntry } from '@/lib/accounting/journal-service'
import {
  type CoaRole,
  cashAccountRoleForBankId,
  cashAccountRoleForMethod,
  labelForRole,
} from '@/lib/accounting/coa-roles'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import { invoiceResidual, roundMoney } from '@/lib/accounting/money'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'

export { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
export { labelForRole, codeForRole, COA_ROLE_CODES, COA_ROLE_LABELS } from '@/lib/accounting/coa-roles'
export type { CoaRole } from '@/lib/accounting/coa-roles'
export { invoiceResidual, roundMoney } from '@/lib/accounting/money'

export type PostingLineInput = {
  /** Preferred: resolve via live CoA role map. */
  role?: CoaRole
  /** Escape hatch when label is already known (e.g. product sale account). */
  accountLabel?: string
  description: string
  debit?: number
  credit?: number
}

export type CommitPostingInput = {
  ref: string
  source: string
  description: string
  date?: string
  invoiceId?: string
  paymentId?: string
  blobId?: string
  lines: PostingLineInput[]
  createdById?: string
  journalCode?: string
}

export function resolvePostingAccountLabel(line: PostingLineInput): string {
  if (line.role) return labelForRole(line.role)
  const label = String(line.accountLabel || '').trim()
  if (!label) throw new Error('Posting line requires role or accountLabel')
  return label
}

export function assertPostingBalanced(lines: Array<{ debit: number; credit: number }>, ref?: string) {
  const debit = roundMoney(lines.reduce((s, l) => s + Number(l.debit || 0), 0))
  const credit = roundMoney(lines.reduce((s, l) => s + Number(l.credit || 0), 0))
  if (Math.abs(debit - credit) > 0.02) {
    throw new Error(`Unbalanced posting${ref ? ` ${ref}` : ''}: debit=${debit} credit=${credit}`)
  }
  if (lines.length === 0) {
    throw new Error(`Posting${ref ? ` ${ref}` : ''} has no lines`)
  }
}

function isCustomerCreditMethod(method?: string) {
  const m = String(method || '').toLowerCase()
  return m === 'customer_credit' || m === 'credit_note' || m === 'credit'
}

function isDepositApplyMethod(method?: string) {
  const m = String(method || '').toLowerCase()
  return m === 'deposit' || m === 'deposit_apply' || m === 'customer_deposit'
}

/** Pure builder — customer invoice (Dr AR, Cr revenue, Cr VAT). */
export function buildCustomerInvoiceLines(params: {
  partnerName: string
  ref: string
  total: number
  subtotal: number
  tax: number
  /** Override revenue label; default company sale fallback (parity with invoice-journals). */
  revenueAccountLabel?: string
}): PostingLineInput[] {
  const total = roundMoney(params.total)
  const subtotal = roundMoney(params.subtotal)
  const tax = roundMoney(params.tax)
  const revenue =
    params.revenueAccountLabel
    || formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, [])
  const lines: PostingLineInput[] = [
    { role: 'ar', description: `AR: ${params.partnerName}`, debit: total, credit: 0 },
    { accountLabel: revenue, description: `Revenue: ${params.ref}`, debit: 0, credit: subtotal },
  ]
  if (tax > 0) {
    lines.push({ role: 'output_vat', description: `VAT on ${params.ref}`, debit: 0, credit: tax })
  }
  return lines
}

/** Pure builder — customer/vendor payment settlement lines. */
export function buildInvoicePaymentLines(params: {
  partnerName: string
  ref: string
  amount: number
  method?: string
  isVendor?: boolean
}): PostingLineInput[] {
  const amount = roundMoney(params.amount)
  const method = String(params.method || '').toLowerCase()

  if (!params.isVendor && isCustomerCreditMethod(method)) {
    return [
      { role: 'customer_credits', description: `Apply credit: ${params.partnerName}`, debit: amount, credit: 0 },
      { role: 'ar', description: `AR settlement: ${params.ref}`, debit: 0, credit: amount },
    ]
  }

  if (!params.isVendor && isDepositApplyMethod(method)) {
    return [
      { role: 'customer_deposits', description: `Clear deposit liability: ${params.partnerName}`, debit: amount, credit: 0 },
      { role: 'ar', description: `AR settlement: ${params.ref}`, debit: 0, credit: amount },
    ]
  }

  const cashRole = cashAccountRoleForMethod(params.method)
  if (params.isVendor) {
    return [
      { role: 'ap', description: `AP settlement: ${params.partnerName}`, debit: amount, credit: 0 },
      { role: cashRole, description: `Payment out: ${params.ref}`, debit: 0, credit: amount },
    ]
  }
  return [
    { role: cashRole, description: `Received from ${params.partnerName}`, debit: amount, credit: 0 },
    { role: 'ar', description: `AR settlement: ${params.ref}`, debit: 0, credit: amount },
  ]
}

/**
 * Customer receipt / vendor payment with optional unallocated (outstanding) remainder.
 * Dr/Cr bank for full amount; settle AR/AP for allocated; park remainder on outstanding clearing.
 */
export function buildPaymentWithOutstandingLines(params: {
  partnerName: string
  paymentRef: string
  method?: string
  isVendor?: boolean
  allocations: Array<{ invoiceRef: string; amount: number }>
  unallocatedAmount: number
}): PostingLineInput[] {
  const allocated = roundMoney(
    params.allocations.reduce((s, a) => s + Number(a.amount || 0), 0),
  )
  const unallocated = roundMoney(params.unallocatedAmount)
  const total = roundMoney(allocated + unallocated)
  if (total <= 0) return []

  const cashRole = cashAccountRoleForMethod(params.method)
  const lines: PostingLineInput[] = []

  if (params.isVendor) {
    lines.push({
      role: cashRole,
      description: `Payment out: ${params.paymentRef}`,
      debit: 0,
      credit: total,
    })
    for (const alloc of params.allocations) {
      const amt = roundMoney(alloc.amount)
      if (amt <= 0) continue
      lines.push({
        role: 'ap',
        description: `AP settlement: ${alloc.invoiceRef}`,
        debit: amt,
        credit: 0,
      })
    }
    if (unallocated > 0) {
      lines.push({
        role: 'outstanding_payments',
        description: `Outstanding payment: ${params.partnerName}`,
        debit: unallocated,
        credit: 0,
      })
    }
    return lines
  }

  lines.push({
    role: cashRole,
    description: `Received from ${params.partnerName}`,
    debit: total,
    credit: 0,
  })
  for (const alloc of params.allocations) {
    const amt = roundMoney(alloc.amount)
    if (amt <= 0) continue
    lines.push({
      role: 'ar',
      description: `AR settlement: ${alloc.invoiceRef}`,
      debit: 0,
      credit: amt,
    })
  }
  if (unallocated > 0) {
    lines.push({
      role: 'outstanding_receipts',
      description: `Outstanding receipt: ${params.partnerName}`,
      debit: 0,
      credit: unallocated,
    })
  }
  return lines
}

/** Apply previously outstanding cash onto invoices/bills (clearing → AR/AP). */
export function buildAllocateOutstandingLines(params: {
  partnerName: string
  paymentRef: string
  isVendor?: boolean
  allocations: Array<{ invoiceRef: string; amount: number }>
}): PostingLineInput[] {
  const lines: PostingLineInput[] = []
  for (const alloc of params.allocations) {
    const amt = roundMoney(alloc.amount)
    if (amt <= 0) continue
    if (params.isVendor) {
      lines.push({
        role: 'outstanding_payments',
        description: `Clear outstanding: ${params.paymentRef}`,
        debit: 0,
        credit: amt,
      })
      lines.push({
        role: 'ap',
        description: `AP settlement: ${alloc.invoiceRef}`,
        debit: amt,
        credit: 0,
      })
    } else {
      lines.push({
        role: 'outstanding_receipts',
        description: `Clear outstanding: ${params.paymentRef}`,
        debit: amt,
        credit: 0,
      })
      lines.push({
        role: 'ar',
        description: `AR settlement: ${alloc.invoiceRef}`,
        debit: 0,
        credit: amt,
      })
    }
  }
  return lines
}

/** Pure builder — GRN / stock receipt (Dr Inventory [+ variance], Cr GRNI). */
export function buildStockReceiptLines(params: {
  inventoryDebit: number
  grniCredit: number
  priceDiffLabel?: string
}): PostingLineInput[] {
  const invDebit = roundMoney(params.inventoryDebit)
  const grniCredit = roundMoney(params.grniCredit)
  const variance = roundMoney(grniCredit - invDebit)
  const lines: PostingLineInput[] = [
    { role: 'inventory', description: 'Inventory receipt', debit: invDebit, credit: 0 },
  ]
  if (variance > 0 && params.priceDiffLabel) {
    lines.push({
      accountLabel: params.priceDiffLabel,
      description: 'Purchase price variance',
      debit: variance,
      credit: 0,
    })
  } else if (variance < 0 && params.priceDiffLabel) {
    lines.push({
      accountLabel: params.priceDiffLabel,
      description: 'Purchase price variance',
      debit: 0,
      credit: roundMoney(-variance),
    })
  }
  lines.push({
    role: 'grni',
    description: 'GRNI / Accruals',
    debit: 0,
    credit: grniCredit || invDebit,
  })
  return lines
}

/** Pure builder — delivery / POS COGS (Dr COGS, Cr Inventory). */
export function buildStockCogsLines(params: { totalCost: number }): PostingLineInput[] {
  const total = roundMoney(params.totalCost)
  return [
    { role: 'cogs', description: 'COGS', debit: total, credit: 0 },
    { role: 'inventory', description: 'Inventory reduction', debit: 0, credit: total },
  ]
}

/** Pure builder — customer return (Dr Inventory, Cr COGS). */
export function buildStockCustomerReturnLines(params: { totalCost: number }): PostingLineInput[] {
  const total = roundMoney(params.totalCost)
  return [
    { role: 'inventory', description: 'Inventory restore', debit: total, credit: 0 },
    { role: 'cogs', description: 'COGS reversal', debit: 0, credit: total },
  ]
}

/** Pure builder — vendor RTV (Dr GRNI, Cr Inventory). */
export function buildStockVendorReturnLines(params: { totalCost: number }): PostingLineInput[] {
  const total = roundMoney(params.totalCost)
  return [
    { role: 'grni', description: 'GRNI on vendor return', debit: total, credit: 0 },
    { role: 'inventory', description: 'Inventory reduction', debit: 0, credit: total },
  ]
}

/** Bank statement fee: Dr Bank Charges, Cr Bank. */
export function buildBankChargeLines(params: {
  amount: number
  bankAccountId?: string
  description?: string
}): PostingLineInput[] {
  const amount = roundMoney(params.amount)
  const cashRole = cashAccountRoleForBankId(params.bankAccountId)
  return [
    {
      role: 'bank_charges',
      description: params.description || 'Bank charges',
      debit: amount,
      credit: 0,
    },
    {
      role: cashRole,
      description: params.description || 'Bank charges',
      debit: 0,
      credit: amount,
    },
  ]
}

/** Bank interest earned: Dr Bank, Cr Interest Income. */
export function buildBankInterestLines(params: {
  amount: number
  bankAccountId?: string
  description?: string
}): PostingLineInput[] {
  const amount = roundMoney(params.amount)
  const cashRole = cashAccountRoleForBankId(params.bankAccountId)
  return [
    {
      role: cashRole,
      description: params.description || 'Interest earned',
      debit: amount,
      credit: 0,
    },
    {
      role: 'interest_income',
      description: params.description || 'Interest earned',
      debit: 0,
      credit: amount,
    },
  ]
}

/**
 * Resolve labels, assert balance, persist via journal-service (fiscal lock + idempotent ref).
 */
export async function commitPosting(input: CommitPostingInput) {
  const resolved = input.lines.map(l => ({
    account: resolvePostingAccountLabel(l),
    description: l.description,
    debit: roundMoney(l.debit),
    credit: roundMoney(l.credit),
  }))
  assertPostingBalanced(resolved, input.ref)

  return persistStoreJournalEntry({
    ref: input.ref,
    date: input.date,
    source: input.source,
    description: input.description,
    invoiceId: input.invoiceId,
    paymentId: input.paymentId,
    id: input.blobId,
    lines: resolved,
  }, { createdById: input.createdById, journalCode: input.journalCode })
}

export async function postCustomerInvoice(params: {
  invoiceId: string
  ref: string
  partnerName: string
  total: number
  subtotal: number
  tax: number
  createdById?: string
  revenueAccountLabel?: string
}) {
  const lines = buildCustomerInvoiceLines({
    partnerName: params.partnerName,
    ref: params.ref,
    total: params.total,
    subtotal: params.subtotal,
    tax: params.tax,
    revenueAccountLabel: params.revenueAccountLabel,
  })
  return commitPosting({
    ref: `JRN/${params.ref}`,
    source: 'invoice',
    description: `Invoice ${params.ref} — ${params.partnerName}`,
    invoiceId: params.invoiceId,
    lines,
    createdById: params.createdById,
    journalCode: 'SAL',
  })
}

/** Vendor bill / credit — lines already built by vendor-bill-perpetual. */
export async function postVendorBill(params: {
  invoiceId: string
  ref: string
  partnerName: string
  isCredit?: boolean
  lines: Array<{ account: string; description: string; debit: number; credit: number }>
  createdById?: string
}) {
  return commitPosting({
    ref: `JRN/${params.ref}`,
    source: 'bill',
    description: `${params.isCredit ? 'Vendor credit' : 'Bill'} ${params.ref} — ${params.partnerName}`,
    invoiceId: params.invoiceId,
    lines: params.lines.map(l => ({
      accountLabel: l.account,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
    })),
    createdById: params.createdById,
    journalCode: 'PUR',
  })
}

/**
 * Stock valuation journal (STK). Prefer role-based builders; accepts accountLabel escape hatches
 * for price-diff / write-off / adjustment accounts.
 */
export async function postStockJournal(params: {
  ref: string
  description: string
  sourceType: string
  sourceId?: string | null
  lines: PostingLineInput[]
  createdById?: string | null
}) {
  return commitPosting({
    ref: params.ref,
    source: params.sourceType,
    description: params.description,
    blobId: params.sourceId || undefined,
    lines: params.lines,
    createdById: params.createdById || undefined,
    journalCode: 'STK',
  })
}

/** Post bank charge or interest adjustment from statement recon (BNK journal). */
export async function postBankStatementAdjustment(params: {
  kind: 'bank_charge' | 'interest_earned'
  amount: number
  bankAccountId: string
  statementLineId?: string
  month: string
  date?: string
  description?: string
  createdById?: string
}) {
  const amount = roundMoney(params.amount)
  if (amount <= 0) return null
  const lines = params.kind === 'bank_charge'
    ? buildBankChargeLines({
        amount,
        bankAccountId: params.bankAccountId,
        description: params.description,
      })
    : buildBankInterestLines({
        amount,
        bankAccountId: params.bankAccountId,
        description: params.description,
      })
  const stamp = params.statementLineId || `${params.month}-${params.kind}`
  return commitPosting({
    ref: `JRN/BNK/${params.kind}/${stamp}`.slice(0, 80),
    source: 'bank_recon',
    description: params.description
      || (params.kind === 'bank_charge'
        ? `Bank charges ${params.bankAccountId} ${params.month}`
        : `Interest earned ${params.bankAccountId} ${params.month}`),
    date: params.date,
    blobId: params.statementLineId,
    lines,
    createdById: params.createdById,
    journalCode: 'BNK',
  })
}

export async function postInvoicePayment(params: {
  invoiceId: string
  paymentId: string
  ref: string
  partnerName: string
  amount: number
  method?: string
  isVendor?: boolean
  createdById?: string
}) {
  const method = String(params.method || '').toLowerCase()
  const lines = buildInvoicePaymentLines({
    partnerName: params.partnerName,
    ref: params.ref,
    amount: params.amount,
    method: params.method,
    isVendor: params.isVendor,
  })
  const journalCode = params.isVendor
    ? 'PUR'
    : (method === 'cash' ? 'CSH' : 'BNK')
  return commitPosting({
    ref: `JRN/PAY/${params.ref}/${params.paymentId}`.slice(0, 80),
    source: params.isVendor ? 'purchase_payment' : 'payment',
    description: !params.isVendor && isCustomerCreditMethod(method)
      ? `Customer credit applied to ${params.ref} — ${params.partnerName}`
      : !params.isVendor && isDepositApplyMethod(method)
        ? `Deposit applied to ${params.ref} — ${params.partnerName}`
        : `Payment for ${params.ref} — ${params.partnerName}`,
    invoiceId: params.invoiceId,
    paymentId: params.paymentId,
    lines,
    createdById: params.createdById,
    journalCode,
  })
}

/** Single journal for a receipt/payment that may leave an outstanding remainder. */
export async function postPaymentWithOutstanding(params: {
  paymentId: string
  paymentRef: string
  partnerName: string
  method?: string
  isVendor?: boolean
  allocations: Array<{ invoiceId?: string; invoiceRef: string; amount: number }>
  unallocatedAmount: number
  createdById?: string
}) {
  const method = String(params.method || '').toLowerCase()
  const lines = buildPaymentWithOutstandingLines({
    partnerName: params.partnerName,
    paymentRef: params.paymentRef,
    method: params.method,
    isVendor: params.isVendor,
    allocations: params.allocations,
    unallocatedAmount: params.unallocatedAmount,
  })
  if (lines.length === 0) return null
  const primaryInvoiceId = params.allocations[0]?.invoiceId ?? null
  return commitPosting({
    ref: `JRN/PAY/${params.paymentRef}/${params.paymentId}`.slice(0, 80),
    source: params.isVendor ? 'purchase_payment' : 'payment',
    description: `Payment ${params.paymentRef} — ${params.partnerName}`,
    invoiceId: primaryInvoiceId || undefined,
    paymentId: params.paymentId,
    lines,
    createdById: params.createdById,
    journalCode: params.isVendor ? 'PUR' : (method === 'cash' ? 'CSH' : 'BNK'),
  })
}

/** Clear outstanding receipts/payments onto invoices after a later allocation. */
export async function postAllocateOutstanding(params: {
  paymentId: string
  paymentRef: string
  partnerName: string
  isVendor?: boolean
  allocations: Array<{ invoiceId: string; invoiceRef: string; amount: number }>
  createdById?: string
}) {
  const lines = buildAllocateOutstandingLines({
    partnerName: params.partnerName,
    paymentRef: params.paymentRef,
    isVendor: params.isVendor,
    allocations: params.allocations,
  })
  if (lines.length === 0) return null
  const stamp = Date.now().toString(36)
  return commitPosting({
    ref: `JRN/PAYALC/${params.paymentRef}/${stamp}`.slice(0, 80),
    source: params.isVendor ? 'purchase_payment' : 'payment',
    description: `Allocate outstanding ${params.paymentRef} — ${params.partnerName}`,
    invoiceId: params.allocations[0]?.invoiceId,
    paymentId: params.paymentId,
    lines,
    createdById: params.createdById,
    journalCode: params.isVendor ? 'PUR' : 'BNK',
  })
}

export async function reversePosting(ref: string, userId?: string) {
  return reverseJournalEntry(ref, userId)
}
