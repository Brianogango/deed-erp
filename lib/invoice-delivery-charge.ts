import type { Invoice, InvoiceLine } from '@/lib/store'

/** Build a single “Delivery charge” invoice line. */
export function buildDeliveryChargeInvoiceLine(opts: {
  id: string
  amount: number
  taxRate: number
}): InvoiceLine {
  const amount = Math.max(0, Number(opts.amount) || 0)
  return {
    id: opts.id,
    description: 'Delivery charge',
    qty: 1,
    unitPrice: amount,
    taxRate: Math.max(0, Number(opts.taxRate) || 0),
    subtotal: amount,
  }
}

export function recomputeInvoiceMoney(lines: InvoiceLine[]): {
  subtotal: number
  taxTotal: number
  total: number
} {
  const itemLines = lines.filter(l => l.lineType !== 'section')
  const subtotal = itemLines.reduce((s, l) => s + Number(l.subtotal || 0), 0)
  const taxTotal = itemLines.reduce(
    (s, l) => s + Math.round(Number(l.subtotal || 0) * (Number(l.taxRate) || 0) / 100),
    0,
  )
  return { subtotal, taxTotal, total: subtotal + taxTotal }
}

/** Append delivery charge and return updated invoice money fields. */
export function appendDeliveryChargeToInvoice(
  invoice: Pick<Invoice, 'lines'>,
  line: InvoiceLine,
): { lines: InvoiceLine[]; subtotal: number; taxTotal: number; total: number } {
  const lines = [...(invoice.lines || []), line]
  return { lines, ...recomputeInvoiceMoney(lines) }
}
