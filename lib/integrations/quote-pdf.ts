import 'server-only'

/**
 * Server-side quotation PDF, attached to Send-by-Email for both CRM quotes
 * and sales quotations. Uses the shared Deed document template.
 */
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { loadAppState } from '@/lib/server-store'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'

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
  const state = await loadAppState(['deed_companySettings', 'deed_bankAccounts'])
  const co = {
    ...DEFAULT_COMPANY_SETTINGS,
    ...((state['deed_companySettings'] as Record<string, unknown> | undefined) ?? {}),
  }
  const banks = ((state['deed_bankAccounts'] as any[] | undefined) ?? DEFAULT_BANK_ACCOUNTS).filter((a: any) => a.active)
  const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)

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
        taxRate: line.taxRate ?? Number(co.vatRate ?? 16),
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
      name: String(co.name ?? ''),
      address: co.address ? String(co.address) : undefined,
      city: co.city ? String(co.city) : undefined,
      phone: co.phone ? String(co.phone) : undefined,
      email: co.email ? String(co.email) : undefined,
      website: co.website ? String(co.website) : undefined,
      kraPin: co.kraPin ? String(co.kraPin) : undefined,
      currency: String(co.currency ?? 'KES'),
      mpesaPaybill: co.mpesaPaybill ? String(co.mpesaPaybill) : undefined,
      mpesaAccount: co.mpesaAccount ? String(co.mpesaAccount) : undefined,
      invoiceFooter: co.invoiceFooter ? String(co.invoiceFooter) : undefined,
      logoDataUrl: logo?.dataUrl,
      logoWidth: logo?.width,
      logoHeight: logo?.height,
      logoFormat: logo?.format,
    },
    banks,
  )

  return Buffer.from(deedPdfToBuffer(doc))
}
