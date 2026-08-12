/**
 * VAT control / return draft helpers (Finance Phase 6).
 * Pure math — GL SoT uses journal aggregates on output_vat (3301) and input_vat (1150).
 */

import { roundMoney } from '@/lib/accounting/money'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'

export type VatAccountAggregate = {
  code: string
  debit: number
  credit: number
}

export type VatControlResult = {
  currency: string
  dateFrom: string | null
  dateTo: string | null
  outputVatCode: string
  inputVatCode: string
  /** Net credit on output VAT account (liability). */
  outputVat: number
  /** Net debit on input VAT account (asset). */
  inputVat: number
  /** output − input (positive = payable). */
  vatPayable: number
  source: 'gl' | 'invoices'
  /** Optional invoice-sum cross-check fields (blob path). */
  taxableSales?: number
  taxablePurchases?: number
}

export type VatReturnDraft = {
  periodLabel: string
  companyPin?: string | null
  vatNumber?: string | null
  currency: string
  dateFrom: string | null
  dateTo: string | null
  boxes: Array<{ code: string; label: string; amount: number }>
  netPayable: number
}

export function outputVatAccountCode(): string {
  return COA_ROLE_CODES.output_vat
}

export function inputVatAccountCode(): string {
  return COA_ROLE_CODES.input_vat
}

/**
 * Build VAT control from journal aggregates.
 * Output VAT (liability): net credit on 3301.
 * Input VAT (asset): net debit on 1150.
 */
export function buildVatControlFromAggregates(
  aggregates: Map<string, VatAccountAggregate> | Iterable<VatAccountAggregate>,
  opts?: { dateFrom?: string | null; dateTo?: string | null },
): VatControlResult {
  const map = aggregates instanceof Map
    ? aggregates
    : new Map(Array.from(aggregates).map(r => [r.code, r]))

  const outCode = outputVatAccountCode()
  const inCode = inputVatAccountCode()
  const outRow = map.get(outCode)
  const inRow = map.get(inCode)

  const outputVat = outRow
    ? roundMoney(Number(outRow.credit || 0) - Number(outRow.debit || 0))
    : 0
  const inputVat = inRow
    ? roundMoney(Number(inRow.debit || 0) - Number(inRow.credit || 0))
    : 0

  return {
    currency: 'KES',
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
    outputVatCode: outCode,
    inputVatCode: inCode,
    outputVat,
    inputVat,
    vatPayable: roundMoney(outputVat - inputVat),
    source: 'gl',
  }
}

/** Invoice-sum path (parity with Accounting.tsx blob VAT tab). */
export function buildVatControlFromInvoices(
  invoices: Array<{
    type?: string
    status?: unknown
    taxTotal?: number
    taxAmount?: number
    subtotal?: number
  }>,
  opts?: {
    dateFrom?: string | null
    dateTo?: string | null
    isPosted?: (status: unknown) => boolean
  },
): VatControlResult {
  const isPosted = opts?.isPosted ?? ((s) => {
    const v = String(s || '').toLowerCase()
    return v === 'posted' || v === 'approved' || v === 'invoiced' || v === 'paid' || v === 'partially_paid'
  })

  let outputVat = 0
  let inputVat = 0
  let taxableSales = 0
  let taxablePurchases = 0

  for (const inv of invoices) {
    if (!isPosted(inv.status)) continue
    const tax = roundMoney(inv.taxTotal ?? inv.taxAmount ?? 0)
    const sub = roundMoney(inv.subtotal ?? 0)
    if (inv.type === 'vendor_bill') {
      inputVat = roundMoney(inputVat + Math.abs(tax))
      taxablePurchases = roundMoney(taxablePurchases + Math.abs(sub))
    } else {
      outputVat = roundMoney(outputVat + Math.abs(tax))
      taxableSales = roundMoney(taxableSales + Math.abs(sub))
    }
  }

  return {
    currency: 'KES',
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
    outputVatCode: outputVatAccountCode(),
    inputVatCode: inputVatAccountCode(),
    outputVat,
    inputVat,
    vatPayable: roundMoney(outputVat - inputVat),
    source: 'invoices',
    taxableSales,
    taxablePurchases,
  }
}

/** Kenya-style return draft DTO (not an eTIMS submission). */
export function buildVatReturnDraft(
  control: VatControlResult,
  opts?: {
    periodLabel?: string
    companyPin?: string | null
    vatNumber?: string | null
  },
): VatReturnDraft {
  const periodLabel = opts?.periodLabel
    || (control.dateFrom && control.dateTo
      ? `${control.dateFrom} → ${control.dateTo}`
      : control.dateTo || control.dateFrom || 'Open period')

  return {
    periodLabel,
    companyPin: opts?.companyPin ?? null,
    vatNumber: opts?.vatNumber ?? null,
    currency: control.currency,
    dateFrom: control.dateFrom,
    dateTo: control.dateTo,
    boxes: [
      { code: 'A', label: 'Output VAT (sales)', amount: control.outputVat },
      { code: 'B', label: 'Input VAT (purchases)', amount: control.inputVat },
      { code: 'C', label: 'Net VAT payable / (refundable)', amount: control.vatPayable },
    ],
    netPayable: control.vatPayable,
  }
}
