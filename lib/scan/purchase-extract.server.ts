import 'server-only'
import { z } from 'zod'
import { readDocumentWithClaude } from '@/lib/ai/read-document.server'

/** Read a supplier's invoice or quotation into draft purchase-order lines. The person checks every line. */

const MAX_LINES = 80

const PurchaseSchema = z.object({
  vendorName: z.string(),
  date: z.string(),
  reference: z.string(),
  subtotal: z.number(),
  taxTotal: z.number(),
  total: z.number(),
  lines: z.array(z.object({
    productName: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    taxRate: z.number(),
    lineTotal: z.number(),
  })),
})

const INSTRUCTIONS = `This is a supplier's invoice, quotation or delivery note addressed to a company in Kenya (KES). Read it exactly as printed:
- vendorName: the supplier who issued the document (not the customer it is addressed to). "" if not shown.
- date: the document date as YYYY-MM-DD. Dates are written day first. "" if not readable.
- reference: the supplier's invoice / quotation number. "" if not shown.
- subtotal, taxTotal, total: the document totals as plain numbers. 0 when not shown.
- lines: one entry per item line, in order. Skip headings, totals, payment details and notes.
  - productName: the item description as printed, including model and specification.
  - qty: the quantity. 1 if not shown.
  - unitPrice: the price for one unit BEFORE VAT, as a plain number. If only a VAT-inclusive price is shown, work out the price before VAT.
  - taxRate: the VAT percent on the line (16 for standard-rated, 0 for exempt or zero-rated). If the document charges VAT overall and the line shows no rate, use 16.
  - lineTotal: the line amount as printed. 0 if not shown.
Copy numbers carefully. Never invent a line or a value you cannot read.`

const money = (n: number) => (n > 0 ? Math.round(n * 100) / 100 : null)

export async function readPurchaseDocument(base64: string, mimeType: string) {
  const { data, engine } = await readDocumentWithClaude({
    base64, mimeType, schema: PurchaseSchema, instructions: INSTRUCTIONS, maxTokens: 16000,
    unreadable: 'The purchase document could not be read — take a clearer photo or add the lines yourself',
  })
  return {
    vendorName: data.vendorName.trim().slice(0, 200),
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : '',
    reference: data.reference.trim().slice(0, 80),
    subtotal: money(data.subtotal),
    taxTotal: money(data.taxTotal),
    total: money(data.total),
    lines: data.lines
      .filter(l => l.productName.trim())
      .slice(0, MAX_LINES)
      .map(l => ({
        productName: l.productName.trim().slice(0, 200),
        qty: l.qty > 0 ? l.qty : 1,
        unitPrice: l.unitPrice >= 0 ? Math.round(l.unitPrice * 100) / 100 : 0,
        taxRate: l.taxRate >= 0 && l.taxRate <= 100 ? l.taxRate : 0,
        lineTotal: money(l.lineTotal),
      })),
    engine,
  }
}
