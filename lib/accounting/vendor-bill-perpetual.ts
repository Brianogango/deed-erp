/**
 * Perpetual inventory posting for vendor bills / vendor credit notes.
 *
 * When automated valuation is on and the bill is linked to a PO, GRN already
 * capitalized inventory (Dr 1200 / Cr GRNI 3201). The bill must clear GRNI and
 * post price variance — not expense purchases again through 6101.
 */

import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { isPpeCostAccount, PPE_COST_LABELS } from '@/lib/company-property-ppe'

export const GRNI_ACCOUNT_LABEL = labelForRole('grni')
export const PRICE_DIFF_ACCOUNT_CODE = COMPANY_ACCOUNT_FALLBACKS.priceDifferenceAccountCode

export type VendorBillLineInput = {
  productId?: string
  qty: number
  unitPrice: number
  subtotal: number
  accountCode?: string
  /** PPE cost account (1701–1704). Debits PPE instead of inventory 1200 / purchases 6101. */
  ppeAccountCode?: string
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

function ppeCodeForLine(line: VendorBillLineInput): string | undefined {
  const code = String(line.ppeAccountCode || line.accountCode || '').trim()
  return isPpeCostAccount(code) ? code : undefined
}

function ppeAccountLabel(code: string, chart: Array<{ code: string; name: string }>) {
  return accountLabel(code, chart) || PPE_COST_LABELS[code as keyof typeof PPE_COST_LABELS] || `${code} — PPE`
}

/**
 * Build vendor-bill posting lines.
 * - PPE account on a line (1701–1704) → Dr cost, never inventory 1200
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
  /** When false, always expense (legacy) except PPE lines. */
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

  const ppeByCode = new Map<string, number>()
  let grniClear = 0
  let billStocked = 0
  let expenseNonStocked = 0
  let classified = 0

  for (const line of params.lines) {
    const qty = Math.max(0, Number(line.qty) || 0)
    if (qty <= 0) continue
    const billSub = money(line.subtotal)
    classified += billSub
    const ppe = ppeCodeForLine(line)
    if (ppe) {
      ppeByCode.set(ppe, money((ppeByCode.get(ppe) ?? 0) + billSub))
      continue
    }
    if (params.perpetual && line.isStocked) {
      const receiptCost = Math.max(0, Number(line.receiptUnitCost ?? line.unitPrice) || 0)
      grniClear = money(grniClear + qty * receiptCost)
      billStocked = money(billStocked + billSub)
    } else {
      expenseNonStocked = money(expenseNonStocked + billSub)
    }
  }

  const ppeTotal = [...ppeByCode.values()].reduce((s, n) => s + n, 0)
  const useLegacyExpense = !params.perpetual && ppeTotal <= 0

  if (useLegacyExpense) {
    const expense = money(params.subtotal)
    return [
      { account: purchaseFallback, description: `Purchase: ${partner}`, debit: expense, credit: 0 },
      ...(tax > 0 ? [{ account: labelForRole('input_vat'), description: `VAT input on ${ref}`, debit: tax, credit: 0 }] : []),
      { account: labelForRole('ap'), description: `AP: ${partner}`, debit: 0, credit: total },
    ]
  }

  // Perpetual with nothing stocked and no PPE → expense the bill (legacy).
  if (params.perpetual && grniClear <= 0 && billStocked <= 0 && ppeTotal <= 0) {
    const expense = money(params.subtotal)
    return [
      { account: purchaseFallback, description: `Purchase: ${partner}`, debit: expense, credit: 0 },
      ...(tax > 0 ? [{ account: labelForRole('input_vat'), description: `VAT input on ${ref}`, debit: tax, credit: 0 }] : []),
      { account: labelForRole('ap'), description: `AP: ${partner}`, debit: 0, credit: total },
    ]
  }

  const variance = money(billStocked - grniClear)
  const lines: VendorBillJournalLine[] = []

  for (const [code, amount] of ppeByCode) {
    if (amount <= 0) continue
    lines.push({
      account: ppeAccountLabel(code, chart),
      description: `Capitalise PPE ${code}: ${ref}`,
      debit: amount,
      credit: 0,
    })
  }
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
    lines.push({ account: labelForRole('input_vat'), description: `VAT input on ${ref}`, debit: tax, credit: 0 })
  }
  lines.push({ account: labelForRole('ap'), description: `AP: ${partner}`, debit: 0, credit: total })

  return lines
}

/**
 * Vendor credit note:
 * - PPE lines credit 170x (never inventory 1200)
 * - perpetual + stocked → credit GRNI
 * - otherwise credit purchase expense
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

  const ppeByCode = new Map<string, number>()
  let grniCredit = 0
  let billStocked = 0
  let expenseNonStocked = 0

  for (const line of params.lines) {
    const qty = Math.max(0, Number(line.qty) || 0)
    if (qty <= 0) continue
    const billSub = money(Math.abs(line.subtotal))
    const ppe = ppeCodeForLine(line)
    if (ppe) {
      ppeByCode.set(ppe, money((ppeByCode.get(ppe) ?? 0) + billSub))
      continue
    }
    if (params.perpetual && line.isStocked) {
      const receiptCost = Math.max(0, Number(line.receiptUnitCost ?? line.unitPrice) || 0)
      grniCredit = money(grniCredit + qty * receiptCost)
      billStocked = money(billStocked + billSub)
    } else {
      expenseNonStocked = money(expenseNonStocked + billSub)
    }
  }

  const ppeTotal = [...ppeByCode.values()].reduce((s, n) => s + n, 0)
  const useLegacyExpense = !params.perpetual && ppeTotal <= 0

  if (useLegacyExpense || (params.perpetual && grniCredit <= 0 && billStocked <= 0 && ppeTotal <= 0)) {
    const expense = money(Math.abs(params.subtotal))
    return [
      { account: labelForRole('ap'), description: `AP credit: ${partner}`, debit: total, credit: 0 },
      { account: purchaseFallback, description: `Purchase return: ${partner}`, debit: 0, credit: expense },
      ...(tax > 0 ? [{ account: labelForRole('input_vat'), description: `VAT input reversal on ${ref}`, debit: 0, credit: tax }] : []),
    ]
  }

  const variance = money(billStocked - grniCredit)
  const lines: VendorBillJournalLine[] = [
    { account: labelForRole('ap'), description: `AP credit: ${partner}`, debit: total, credit: 0 },
  ]
  for (const [code, amount] of ppeByCode) {
    if (amount <= 0) continue
    lines.push({
      account: ppeAccountLabel(code, chart),
      description: `Credit PPE ${code}: ${ref}`,
      debit: 0,
      credit: amount,
    })
  }
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
    lines.push({ account: labelForRole('input_vat'), description: `VAT input reversal on ${ref}`, debit: 0, credit: tax })
  }
  return lines
}
