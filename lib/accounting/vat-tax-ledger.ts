/**
 * Statutory VAT return from tax_transactions (invoice/eTIMS evidence layer).
 * GL 3301/1150 remains a control cross-check, not the return source.
 */

import { roundMoney } from '@/lib/accounting/money'

export type TaxTxnLike = {
  direction: string
  taxAmount: unknown
  taxableBase: unknown
  taxPeriod?: string | null
  taxPoint?: Date | string | null
  etimsInvoiceNo?: string | null
  etimsControlUnitNo?: string | null
  transmissionStatus?: string | null
  inputClaimEligible?: boolean | null
  withholdingVat?: unknown
}

export type StatutoryVatReturn = {
  currency: string
  source: 'tax_transactions'
  dateFrom: string | null
  dateTo: string | null
  taxPeriod: string | null
  taxableSales: number
  taxablePurchases: number
  outputVat: number
  inputVat: number
  withholdingVat: number
  vatPayable: number
  transactionCount: number
  etimsLinkedCount: number
  pendingTransmissionCount: number
  boxes: Array<{ code: string; label: string; amount: number }>
}

export function buildStatutoryVatReturn(
  rows: TaxTxnLike[],
  opts?: { dateFrom?: string | null; dateTo?: string | null; taxPeriod?: string | null },
): StatutoryVatReturn {
  let taxableSales = 0
  let taxablePurchases = 0
  let outputVat = 0
  let inputVat = 0
  let withholdingVat = 0
  let etimsLinkedCount = 0
  let pendingTransmissionCount = 0

  for (const row of rows) {
    const tax = roundMoney(row.taxAmount)
    const base = roundMoney(row.taxableBase)
    const direction = String(row.direction || '').toLowerCase()
    if (direction === 'output') {
      outputVat = roundMoney(outputVat + tax)
      taxableSales = roundMoney(taxableSales + base)
    } else if (direction === 'input') {
      const claimable = row.inputClaimEligible !== false
      if (claimable) {
        inputVat = roundMoney(inputVat + tax)
        taxablePurchases = roundMoney(taxablePurchases + base)
      }
    }
    withholdingVat = roundMoney(withholdingVat + Number(row.withholdingVat || 0))
    if (row.etimsInvoiceNo || row.etimsControlUnitNo) etimsLinkedCount += 1
    const status = String(row.transmissionStatus || '').toLowerCase()
    if (status === 'pending' || status === 'pending_evidence') pendingTransmissionCount += 1
  }

  const vatPayable = roundMoney(outputVat - inputVat - withholdingVat)
  return {
    currency: 'KES',
    source: 'tax_transactions',
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
    taxPeriod: opts?.taxPeriod ?? null,
    taxableSales,
    taxablePurchases,
    outputVat,
    inputVat,
    withholdingVat,
    vatPayable,
    transactionCount: rows.length,
    etimsLinkedCount,
    pendingTransmissionCount,
    boxes: [
      { code: 'A', label: 'Output VAT (sales / credit notes)', amount: outputVat },
      { code: 'B', label: 'Input VAT (eligible purchases)', amount: inputVat },
      { code: 'C', label: 'Withholding VAT', amount: withholdingVat },
      { code: 'D', label: 'Net VAT payable / (refundable)', amount: vatPayable },
    ],
  }
}
