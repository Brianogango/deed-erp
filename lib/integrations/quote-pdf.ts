import 'server-only'

/**
 * Server-side quotation PDF, attached to Send-by-Email for both CRM quotes
 * and sales quotations. Uses the shared Deed document template.
 */
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'

export interface QuotePdfInput {
  ref: string
  companyName: string
  contactPersonName?: string
  date?: string
  validUntil?: string
  lines: Array<{ productName: string; qty: number; unitPrice?: number; lineTotal: number; taxRate?: number }>
  subtotal?: number
  taxTotal?: number
  total: number
  paymentTerms?: string
  notes?: string
}

export async function generateQuotePdfBuffer(quote: QuotePdfInput): Promise<Buffer> {
  const co = DEFAULT_COMPANY_SETTINGS
  const banks = DEFAULT_BANK_ACCOUNTS.filter(a => a.active)

  const doc = buildDeedDocumentPdf(
    {
      title: 'Quotation',
      ref: quote.ref,
      date: quote.date,
      dueLabel: 'Valid Until',
      dueDate: quote.validUntil,
      customerName: quote.companyName,
      customerCountry: 'Kenya',
      attention: quote.contactPersonName && quote.contactPersonName !== quote.companyName
        ? quote.contactPersonName
        : undefined,
      lines: quote.lines.map(line => ({
        description: line.productName,
        qty: line.qty,
        unitPrice: line.unitPrice ?? 0,
        taxRate: line.taxRate ?? co.vatRate,
        subtotal: line.lineTotal,
      })),
      subtotal: quote.subtotal ?? quote.total,
      taxTotal: quote.taxTotal ?? 0,
      total: quote.total,
      notes: [quote.paymentTerms ? `Payment Terms: ${quote.paymentTerms}` : '', quote.notes ?? '']
        .filter(Boolean)
        .join('\n') || undefined,
      paymentCommunication: true,
    },
    {
      name: co.name,
      address: co.address,
      city: co.city,
      phone: co.phone,
      email: co.email,
      website: co.website,
      kraPin: co.kraPin,
      currency: co.currency,
      mpesaPaybill: co.mpesaPaybill,
      mpesaAccount: co.mpesaAccount,
      invoiceFooter: co.invoiceFooter,
    },
    banks,
  )

  return Buffer.from(deedPdfToBuffer(doc))
}
