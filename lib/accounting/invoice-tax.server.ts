import 'server-only'

import prisma from '@/lib/prisma'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'

/**
 * Write a booked invoice's or bill's VAT into the tax subledger
 * (tax_transactions), which feeds the VAT return and the VAT integrity check.
 *
 * Only Confirm (PUT /api/invoices/[id]) used to do this. Documents booked any
 * other way — posted at creation, the portal's repair approval, a repost, an
 * import — reached the ledger with their VAT but no tax record, so the return
 * under-reported output VAT. Idempotent: one row per line, upserted.
 *
 * When the lines carry no tax but the document does (a total-level VAT
 * figure), one document-level row ('doc') carries it.
 */
export async function recordInvoiceTax(invoiceId: string, journalEntryId: string | null): Promise<number> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, client: { select: { kraPin: true } } },
  })
  if (!invoice) return 0
  const isBill = invoiceDocumentType(invoice) === 'vendor_bill'
  const sourceType = isBill ? 'vendor_bill' : 'invoice'
  const taxPoint = invoice.invoiceDate ?? new Date()
  const common = {
    direction: isBill ? 'input' : 'output',
    taxPoint,
    taxPeriod: new Date(taxPoint).toISOString().slice(0, 7),
    partnerPin: invoice.client?.kraPin ?? null,
    transmissionStatus: isBill ? 'pending_evidence' : 'pending',
    journalEntryId,
  }

  const docTax = Number(invoice.taxAmount)
  const lineTax = invoice.items.reduce((s, i) => s + Number(i.lineTax), 0)
  const rows = invoice.items.length && (Math.abs(lineTax - docTax) < 1 || lineTax > 0)
    ? invoice.items.map(item => ({
        sourceLineId: item.id,
        taxCategory: String(item.taxCategory || 'not_selected'),
        taxRate: item.taxRate,
        taxableBase: Number(item.taxableBase) > 0 ? item.taxableBase : item.lineSubtotal,
        taxAmount: item.lineTax,
        inputClaimEligible: isBill ? Boolean(item.taxClaimEligible) : false,
      }))
    : [{
        sourceLineId: 'doc',
        taxCategory: 'standard',
        taxRate: Number(invoice.subtotal) > 0 ? Math.round((docTax / Number(invoice.subtotal)) * 10000) / 100 : 0,
        taxableBase: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        inputClaimEligible: isBill,
      }]

  for (const row of rows) {
    const { sourceLineId, ...data } = row
    await prisma.taxTransaction.upsert({
      where: { sourceType_sourceId_sourceLineId: { sourceType, sourceId: invoiceId, sourceLineId } },
      update: { ...common, ...data },
      create: { sourceType, sourceId: invoiceId, sourceLineId, ...common, ...data },
    })
  }
  return rows.length
}
