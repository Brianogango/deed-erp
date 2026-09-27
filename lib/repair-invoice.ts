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

/**
 * The VAT rate this quote actually carries, read back from the quote itself.
 *
 * There were two contradictory VAT rules. Quotes are built by
 * taxableQuoteSubtotal, which taxes every line except the diagnosis fee. This
 * function used to tax only `part`, `software` and `license`, so a quote with
 * VAT on labour — REP-499EXM5H: 3,000 labour, 480 VAT, 4,480 total — was
 * recomputed here as 4,000, and the invoice that correctly billed 4,480 was
 * reported as out of step with its own quote. Every such repair showed "Align
 * invoice with quote" permanently, and on a draft invoice that button would
 * have rewritten it to 4,000, stripping VAT that had been charged properly.
 *
 * Rather than replace one hardcoded rule with another, the rate comes from the
 * document: tax ÷ taxable subtotal. A quote that carried no VAT still carries
 * none, a quote taxed at a rate that has since changed in company settings
 * still reconciles against what it actually charged, and the comparison no
 * longer depends on settings being loaded — `companySettings?.vatRate ?? 0`
 * silently yielded 0 and broke the same comparison a second way.
 */
function quoteEffectiveVatRate(repair: RepairInvoiceSource): number {
  const tax = money(repair.quote?.tax)
  if (tax <= 0) return 0
  const taxable = (repair.quote?.lines ?? [])
    .filter(line => line && !isDiagnosisFeeLine(line))
    .reduce((sum, line) => sum + money(line.subtotal), 0)
  if (taxable <= 0) return 0
  return (tax / taxable) * 100
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
      taxRate: quoteHasTax && applyVat ? quoteEffectiveVatRate(repair) : 0,
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
  invoice: { lines?: { qty?: unknown; unitPrice?: unknown; subtotal?: unknown; lineType?: string; description?: unknown }[] | null; total?: unknown } | null | undefined,
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

/**
 * The only state in which an invoice's lines may still be rewritten in place.
 *
 * Posting is what freezes a document, not payment. `canRewriteInvoice` used to
 * ask only whether anything had been paid, so a posted invoice with no payment
 * against it — the ordinary case for a repair billed on credit — was offered an
 * "Align invoice with quote" button that the server then refused with "posted
 * and immutable". The UI was proposing an action that could never succeed.
 */
const REWRITABLE_INVOICE_STATUSES = new Set(['draft'])

export type RepairBillingSyncState = {
  needed: boolean
  canRewriteInvoice: boolean
  /**
   * The invoice is frozen and no longer matches the approved charges. The
   * correction is a credit or debit note in the Invoice module, which is a
   * different action from rewriting a draft and belongs to Finance.
   */
  requiresCreditNote: boolean
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
  const invoiceRewritable = REWRITABLE_INVOICE_STATUSES.has(String(opts.invoice?.status ?? '').toLowerCase())
  const canRewriteInvoice = !missingInvoice && !invoicePaid && invoiceRewritable && !matchesInvoice
  // Frozen and out of step with the approved quote. Still worth surfacing —
  // the discrepancy is real — but the remedy is a credit note, not an edit.
  const requiresCreditNote = !missingInvoice && !invoiceRewritable && !matchesInvoice
  const needed = missingInvoice || quoteOpen || saleOrderOpen || canRewriteInvoice || requiresCreditNote
  return { needed, canRewriteInvoice, requiresCreditNote, quoteOpen, saleOrderOpen, matchesInvoice, invoicePaid, missingInvoice }
}
