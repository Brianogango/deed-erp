/**
 * The repair quote as the client downloads it from the portal — the same
 * figures they approve on screen.
 *
 * Pure: the route loads the repair and hands the result to the PDF builder.
 */

type QuoteLine = {
  description?: string
  productName?: string
  qty?: number | string
  unitPrice?: number | string
  subtotal?: number | string
  decision?: 'approved' | 'declined' | 'deferred' | string
}

export type RepairWithQuote = {
  ref: string
  productName?: string
  deviceBrand?: string
  deviceModel?: string
  serialNumber?: string
  customerName?: string
  salesQuoteRef?: string
  quote?: {
    lines?: QuoteLine[]
    subtotal?: number
    tax?: number
    total?: number
    approvedTotal?: number
    sentDate?: string
    createdDate?: string
    validUntil?: string
    approvedDate?: string
    rejectedDate?: string
  } | null
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const day = (v?: string) => (v ? String(v).slice(0, 10) : '')

export function repairQuoteDocument(repair: RepairWithQuote, today: string) {
  const quote = repair.quote
  if (!quote || !(quote.lines ?? []).length) return null

  const subtotal = num(quote.subtotal)
  const tax = num(quote.tax)
  // One VAT rate for the whole quote: the repair stores the tax, not per line.
  const taxRate = subtotal > 0 ? Math.round((tax / subtotal) * 100) : 0

  const lines = (quote.lines ?? []).map(line => {
    const label = String(line.description || line.productName || 'Item')
    const suffix = line.decision === 'declined' ? ' (declined)' : line.decision === 'deferred' ? ' (deferred)' : ''
    return {
      description: `${label}${suffix}`,
      qty: num(line.qty) || 1,
      unitPrice: num(line.unitPrice),
      taxRate,
      subtotal: num(line.subtotal) || num(line.qty) * num(line.unitPrice),
    }
  })

  const device = [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ') || repair.productName || ''
  const status = quote.approvedDate
    ? `Approved on ${day(quote.approvedDate)}${quote.approvedTotal !== undefined && quote.approvedTotal !== quote.total ? ` — approved amount KES ${num(quote.approvedTotal).toLocaleString('en-KE')}` : ''}.`
    : quote.rejectedDate
      ? `Declined on ${day(quote.rejectedDate)}.`
      : 'Awaiting your approval on the repair tracking page.'

  return {
    title: 'Quotation',
    partyLabel: 'Prepared For',
    ref: repair.salesQuoteRef || `${repair.ref}-QUOTE`,
    date: quote.sentDate || quote.createdDate || today,
    dueLabel: 'Valid Until',
    dueDate: quote.validUntil || undefined,
    sourceRef: repair.ref,
    lines,
    subtotal,
    taxTotal: tax,
    total: num(quote.total),
    notes: [
      device ? `Device: ${device}` : '',
      repair.serialNumber ? `S/N: ${repair.serialNumber}` : '',
      `Repair ${repair.ref}. ${status}`,
    ].filter(Boolean).join('\n'),
  }
}
