import { isDiagnosisFeeLine, shouldChargeDiagnosisFee } from '@/lib/diagnosis-fee'

export type RepairInvoiceChargeLine = {
  description: string
  qty: number
  unitPrice: number
  taxRate: number
  subtotal: number
  productId?: string
}

type QuoteLikeLine = {
  type?: string
  description?: string
  productId?: string
  productName?: string
  qty?: number
  unitPrice?: number
  price?: number
  subtotal?: number
  decision?: string
  isDiagnosisFee?: boolean
}

export type RepairInvoiceSource = {
  partsUsed?: { productName?: string; qty?: number; price?: number }[] | null
  laborCost?: number | null
  logisticsCost?: number | null
  quote?: { lines?: QuoteLikeLine[] | null; tax?: number | null } | null
  diagnosisFee?: number | null
  diagnosisFeeStatus?: string | null
  diagnosisFeePaidAt?: string | null
  diagnosisStopped?: boolean | null
  billingExempt?: boolean | null
  underWarranty?: boolean | null
  warrantyCoverage?: string | null
  repairPath?: string | null
  intakeDate?: string | null
}

function money(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function vatForQuoteType(type: string | undefined, applyVat: boolean, vatRate: number): number {
  if (!applyVat) return 0
  return type === 'part' || type === 'software' || type === 'license' ? vatRate : 0
}

function quoteLineDescription(line: QuoteLikeLine): string {
  const raw = String(line.description || line.productName || 'Service').trim() || 'Service'
  const type = String(line.type ?? '').trim()
  return type ? `[${type.toUpperCase()}] ${raw}` : raw
}

function executionCharges(
  repair: RepairInvoiceSource,
  applyVat: boolean,
  vatRate: number,
): RepairInvoiceChargeLine[] {
  const partVat = applyVat ? vatRate : 0
  const parts = (repair.partsUsed ?? []).map(part => ({
    description: `Part: ${part.productName ?? 'Part'}`,
    qty: money(part.qty) || 1,
    unitPrice: money(part.price),
    taxRate: partVat,
    subtotal: (money(part.qty) || 1) * money(part.price),
  }))
  const labor = money(repair.laborCost)
  const logistics = money(repair.logisticsCost)
  return [
    ...parts,
    ...(labor > 0 ? [{
      description: 'Labor & Service Charges',
      qty: 1,
      unitPrice: labor,
      taxRate: 0,
      subtotal: labor,
    }] : []),
    ...(logistics > 0 ? [{
      description: 'Delivery Service',
      qty: 1,
      unitPrice: logistics,
      taxRate: 0,
      subtotal: logistics,
    }] : []),
  ]
}

function quoteCharges(
  repair: RepairInvoiceSource,
  applyVat: boolean,
  vatRate: number,
): RepairInvoiceChargeLine[] {
  const lines = repair.quote?.lines ?? []
  const quoteHasTax = money(repair.quote?.tax) > 0
  return lines.flatMap(line => {
    if (!line || line.decision === 'declined') return []
    if (isDiagnosisFeeLine(line)) return []
    const qty = money(line.qty) || 1
    const unitPrice = money(line.unitPrice ?? line.price)
    const subtotal = money(line.subtotal) || qty * unitPrice
    if (subtotal < 0.01 && unitPrice <= 0) return []
    return [{
      description: quoteLineDescription(line),
      qty,
      unitPrice,
      taxRate: quoteHasTax ? vatForQuoteType(line.type, applyVat, vatRate) : 0,
      subtotal: qty * unitPrice,
      productId: line.productId,
    }]
  })
}

function diagnosisCharges(repair: RepairInvoiceSource): RepairInvoiceChargeLine[] {
  const feeRepair = {
    ...repair,
    underWarranty: repair.underWarranty ?? undefined,
    billingExempt: repair.billingExempt ?? undefined,
  }
  if (!shouldChargeDiagnosisFee(feeRepair) || !(repair.diagnosisFee ?? 0)) return []
  if (repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt) return []
  if (repair.diagnosisFeeStatus === 'waived' || repair.diagnosisFeeStatus === 'not_applicable') return []
  const amount = money(repair.diagnosisFee)
  if (amount <= 0) return []
  return [{
    description: repair.diagnosisStopped
      ? 'Diagnosis Fee (repair not undertaken)'
      : 'Diagnosis Fee',
    qty: 1,
    unitPrice: amount,
    taxRate: 0,
    subtotal: amount,
  }]
}

export function executionChargeTotal(repair: RepairInvoiceSource): number {
  return executionCharges(repair, false, 0).reduce((sum, line) => sum + line.subtotal, 0)
}

export function quoteChargeTotal(
  repair: RepairInvoiceSource,
  applyVat = true,
  vatRate = 0,
): number {
  return quoteCharges(repair, applyVat, vatRate).reduce((sum, line) => sum + line.subtotal, 0)
}

/**
 * Bill the approved repair quote. Workshop `partsUsed` is inventory, not the
 * commercial offer — only use it when there is no billable quote.
 */
export function buildRepairInvoiceCharges(
  repair: RepairInvoiceSource,
  applyVat = true,
  vatRate = 0,
): RepairInvoiceChargeLine[] {
  const quoted = quoteCharges(repair, applyVat, vatRate)
  const body = quoteChargeTotal(repair, applyVat, vatRate) >= 1 || quoted.length > 0
    ? quoted
    : executionCharges(repair, applyVat, vatRate)
  return [...body, ...diagnosisCharges(repair)]
}

export function repairInvoiceChargeTotal(lines: RepairInvoiceChargeLine[]): number {
  return lines.reduce((sum, line) => {
    const tax = Math.round(line.subtotal * (line.taxRate || 0) / 100)
    return sum + line.subtotal + tax
  }, 0)
}

function lineFingerprint(row: { qty?: unknown; unitPrice?: unknown; subtotal?: unknown }): string {
  const qty = money(row.qty)
  const unitPrice = money(row.unitPrice)
  const subtotal = money(row.subtotal) || qty * unitPrice
  return `${qty}x${unitPrice}=${subtotal}`
}

export function invoiceMatchesRepairCharges(
  invoice: { lines?: { qty?: unknown; unitPrice?: unknown; subtotal?: unknown; lineType?: string }[] | null; total?: unknown } | null | undefined,
  charges: RepairInvoiceChargeLine[],
): boolean {
  if (!invoice) return false
  const expectedTotal = repairInvoiceChargeTotal(charges)
  if (Math.abs(money(invoice.total) - expectedTotal) > 1) return false
  const invLines = (invoice.lines ?? []).filter(line => line?.lineType !== 'section')
  if (invLines.length !== charges.length) return false
  const invoiceFp = invLines.map(lineFingerprint).sort().join('|')
  const chargeFp = charges.map(lineFingerprint).sort().join('|')
  return invoiceFp === chargeFp
}

const ACCEPTED_QUOTE_STATUSES = new Set(['accepted', 'revised'])
const OPEN_QUOTATION_STATUSES = new Set(['quotation', 'quotation_sent'])

export type RepairBillingSyncState = {
  needed: boolean
  canRewriteInvoice: boolean
  quoteOpen: boolean
  saleOrderOpen: boolean
  matchesInvoice: boolean
  invoicePaid: boolean
  missingInvoice: boolean
}

export function repairBillingNeedsSync(opts: {
  salesQuoteStatus?: string | null
  saleOrderStatus?: string | null
  invoice?: { lines?: { qty?: unknown; unitPrice?: unknown; subtotal?: unknown; lineType?: string }[] | null; total?: unknown; amountPaid?: unknown; status?: string | null } | null
  charges: RepairInvoiceChargeLine[]
}): RepairBillingSyncState {
  const quoteOpen = !!opts.salesQuoteStatus && !ACCEPTED_QUOTE_STATUSES.has(String(opts.salesQuoteStatus).toLowerCase())
  const saleOrderOpen = !!opts.saleOrderStatus && OPEN_QUOTATION_STATUSES.has(String(opts.saleOrderStatus).toLowerCase())
  const missingInvoice = !opts.invoice || String(opts.invoice.status ?? '').toLowerCase() === 'cancelled'
  const matchesInvoice = !missingInvoice && invoiceMatchesRepairCharges(opts.invoice, opts.charges)
  const invoicePaid = money(opts.invoice?.amountPaid) > 0
  const canRewriteInvoice = !missingInvoice && !invoicePaid && !matchesInvoice
  const needed = missingInvoice || quoteOpen || saleOrderOpen || canRewriteInvoice
  return { needed, canRewriteInvoice, quoteOpen, saleOrderOpen, matchesInvoice, invoicePaid, missingInvoice }
}
