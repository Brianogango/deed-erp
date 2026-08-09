/**
 * Perpetual inventory posting for vendor bills / vendor credit notes.
 *
 * When automated valuation is on and the bill is linked to a PO, GRN already
 * capitalized inventory (Dr 1200 / Cr GRNI 3201). The bill must clear GRNI and
 * post price variance — not expense purchases again through 6101.
 */

import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'

export const GRNI_ACCOUNT_LABEL = '3201 - Accruals'
export const PRICE_DIFF_ACCOUNT_CODE = COMPANY_ACCOUNT_FALLBACKS.priceDifferenceAccountCode

export type VendorBillLineInput = {
  productId?: string
  qty: number
  unitPrice: number
  subtotal: number
  accountCode?: string
  /** True when the product is inventory-tracked (storable/consumable). */
  isStocked?: boolean
  /** PO / GRN unit cost used when inventory was capitalized. Defaults to unitPrice. */
  receiptUnitCost?: number
}

export type VendorBillJournalLine = {
  account: string
  description: string
  debit: number
  credit: number
}

function money(n: unknown) {
  return Math.round(Number(n || 0) * 100) / 100
}

function accountLabel(code: string, chartAccounts: Array<{ code: string; name: string }> = []) {
  return formatAccountLabel(code, chartAccounts)
}

/**
 * Build vendor-bill posting lines.
 * - perpetual + stocked PO lines → clear GRNI at receipt cost + price variance
 * - otherwise → classic Dr purchase expense
 */
export function buildVendorBillPerpetualLines(params: {
  partnerName: string
  ref: string
  subtotal: number
  taxTotal: number
  total: number
  lines: VendorBillLineInput[]
  /** When false, always expense (legacy). */
  perpetual: boolean
  chartAccounts?: Array<{ code: string; name: string }>
}): VendorBillJournalLine[] {
  const chart = params.chartAccounts ?? []
  const purchaseFallback = accountLabel(COMPANY_ACCOUNT_FALLBACKS.costAccountCode, chart)
  const priceDiffLabel = accountLabel(PRICE_DIFF_ACCOUNT_CODE, chart)
  const tax = money(params.taxTotal)
  const total = money(params.total)
  const partner = params.partnerName || 'Vendor'
  const ref = params.ref

  if (!params.perpetual) {
    const expense = money(params.subtotal)
    return [
      { account: purchaseFallback, description: `Purchase: ${partner}`, debit: expense, credit: 0 },
      ...(tax > 0 ? [{ account: '1150 - VAT Input', description: `VAT input on ${ref}`, debit: tax, credit: 0 }] : []),
      { account: '3000 - Accounts Payable', description: `AP: ${partner}`, debit: 0, credit: total },
    ]
  }

  let grniClear = 0
  let billStocked = 0
  let expenseNonStocked = 0

  for (const line of params.lines) {
    const qty = Math.max(0, Number(line.qty) || 0)
    if (qty <= 0) continue
    const billSub = money(line.subtotal)
    if (line.isStocked) {
      const receiptCost = Math.max(0, Number(line.receiptUnitCost ?? line.unitPrice) || 0)
      grniClear = money(grniClear + qty * receiptCost)
      billStocked = money(billStocked + billSub)
    } else {
      expenseNonStocked = money(expenseNonStocked + billSub)
    }
  }

  // If nothing was classified as stocked, fall back to expense posting.
  if (grniClear <= 0 && billStocked <= 0) {
    const expense = money(params.subtotal)
    return [
      { account: purchaseFallback, description: `Purchase: ${partner}`, debit: expense, credit: 0 },
      ...(tax > 0 ? [{ account: '1150 - VAT Input', description: `VAT input on ${ref}`, debit: tax, credit: 0 }] : []),
      { account: '3000 - Accounts Payable', description: `AP: ${partner}`, debit: 0, credit: total },
    ]
  }

  const variance = money(billStocked - grniClear)
  const lines: VendorBillJournalLine[] = []

  if (grniClear > 0) {
    lines.push({
      account: GRNI_ACCOUNT_LABEL,
      description: `Clear GRNI: ${ref}`,
      debit: grniClear,
      credit: 0,
    })
  }
  if (variance > 0) {
    lines.push({
      account: priceDiffLabel,
      description: `Purchase price variance (bill > GRN): ${ref}`,
      debit: variance,
      credit: 0,
    })
  } else if (variance < 0) {
    lines.push({
      account: priceDiffLabel,
      description: `Purchase price variance (bill < GRN): ${ref}`,
      debit: 0,
      credit: money(-variance),
    })
  }
  if (expenseNonStocked > 0) {
    lines.push({
      account: purchaseFallback,
      description: `Non-stocked purchase: ${partner}`,
      debit: expenseNonStocked,
      credit: 0,
    })
  }
  if (tax > 0) {
    lines.push({ account: '1150 - VAT Input', description: `VAT input on ${ref}`, debit: tax, credit: 0 })
  }
  lines.push({ account: '3000 - Accounts Payable', description: `AP: ${partner}`, debit: 0, credit: total })

  return lines
}

/**
 * Vendor credit note under perpetual inventory:
 * Dr AP, Cr GRNI (for stocked cost), Cr VAT; non-stocked credits purchase expense.
 * Pair with processStockVendorReturn (Dr GRNI / Cr Inventory) so net is Dr AP / Cr Inventory.
 */
export function buildVendorCreditPerpetualLines(params: {
  partnerName: string
  ref: string
  subtotal: number
  taxTotal: number
  total: number
  lines: VendorBillLineInput[]
  perpetual: boolean
  chartAccounts?: Array<{ code: string; name: string }>
}): VendorBillJournalLine[] {
  const chart = params.chartAccounts ?? []
  const purchaseFallback = accountLabel(COMPANY_ACCOUNT_FALLBACKS.costAccountCode, chart)
  const priceDiffLabel = accountLabel(PRICE_DIFF_ACCOUNT_CODE, chart)
  const tax = money(Math.abs(params.taxTotal))
  const total = money(Math.abs(params.total))
  const partner = params.partnerName || 'Vendor'
  const ref = params.ref

  if (!params.perpetual) {
    const expense = money(Math.abs(params.subtotal))
    return [
      { account: '3000 - Accounts Payable', description: `AP credit: ${partner}`, debit: total, credit: 0 },
      { account: purchaseFallback, description: `Purchase return: ${partner}`, debit: 0, credit: expense },
      ...(tax > 0 ? [{ account: '1150 - VAT Input', description: `VAT input reversal on ${ref}`, debit: 0, credit: tax }] : []),
    ]
  }

  let grniCredit = 0
  let billStocked = 0
  let expenseNonStocked = 0

  for (const line of params.lines) {
    const qty = Math.max(0, Number(line.qty) || 0)
    if (qty <= 0) continue
    const billSub = money(Math.abs(line.subtotal))
    if (line.isStocked) {
      const receiptCost = Math.max(0, Number(line.receiptUnitCost ?? line.unitPrice) || 0)
      grniCredit = money(grniCredit + qty * receiptCost)
      billStocked = money(billStocked + billSub)
    } else {
      expenseNonStocked = money(expenseNonStocked + billSub)
    }
  }

  if (grniCredit <= 0 && billStocked <= 0) {
    const expense = money(Math.abs(params.subtotal))
    return [
      { account: '3000 - Accounts Payable', description: `AP credit: ${partner}`, debit: total, credit: 0 },
      { account: purchaseFallback, description: `Purchase return: ${partner}`, debit: 0, credit: expense },
      ...(tax > 0 ? [{ account: '1150 - VAT Input', description: `VAT input reversal on ${ref}`, debit: 0, credit: tax }] : []),
    ]
  }

  const variance = money(billStocked - grniCredit)
  const lines: VendorBillJournalLine[] = [
    { account: '3000 - Accounts Payable', description: `AP credit: ${partner}`, debit: total, credit: 0 },
  ]
  if (grniCredit > 0) {
    lines.push({
      account: GRNI_ACCOUNT_LABEL,
      description: `GRNI on return: ${ref}`,
      debit: 0,
      credit: grniCredit,
    })
  }
  if (variance > 0) {
    lines.push({
      account: priceDiffLabel,
      description: `Return price variance: ${ref}`,
      debit: 0,
      credit: variance,
    })
  } else if (variance < 0) {
    lines.push({
      account: priceDiffLabel,
      description: `Return price variance: ${ref}`,
      debit: money(-variance),
      credit: 0,
    })
  }
  if (expenseNonStocked > 0) {
    lines.push({
      account: purchaseFallback,
      description: `Purchase return (non-stocked): ${partner}`,
      debit: 0,
      credit: expenseNonStocked,
    })
  }
  if (tax > 0) {
    lines.push({ account: '1150 - VAT Input', description: `VAT input reversal on ${ref}`, debit: 0, credit: tax })
  }
  return lines
}
