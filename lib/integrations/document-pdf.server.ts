import 'server-only'

/**
 * PDFs that go out attached to emails, on the company letterhead (logo,
 * colours, footer) shared with every printed document.
 *  - Payment receipt: attached to the "payment received" email to a customer.
 *  - Request for quotation: attached to the RFQ email to a supplier.
 */
import { buildDeedDocumentPdf, deedPdfToBuffer, type DeedPdfInput } from '@/lib/deed-document-pdf'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { loadAppState } from '@/lib/server-store'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'
import prisma from '@/lib/prisma'

export type EmailAttachment = { filename: string; content: Buffer; contentType: string }

async function companyPdf(input: DeedPdfInput, withBanks: boolean): Promise<Buffer> {
  const state = await loadAppState(['deed_companySettings', 'deed_bankAccounts'])
  const co: Record<string, any> = {
    ...DEFAULT_COMPANY_SETTINGS,
    ...((state['deed_companySettings'] as Record<string, unknown> | undefined) ?? {}),
  }
  const banks = withBanks
    ? ((state['deed_bankAccounts'] as any[] | undefined) ?? DEFAULT_BANK_ACCOUNTS).filter((a: any) => a?.active)
    : []
  const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)
  const doc = buildDeedDocumentPdf(input, {
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
    printTemplate: co.printTemplate,
    printFont: co.printFont,
    printBackground: co.printBackground,
    printPrimaryColor: co.printPrimaryColor,
    printSecondaryColor: co.printSecondaryColor,
    printTagline: co.printTagline,
    printPaperFormat: co.printPaperFormat,
    invoiceFooter: co.invoiceFooter ? String(co.invoiceFooter) : undefined,
    logoDataUrl: logo?.dataUrl,
    logoWidth: logo?.width,
    logoHeight: logo?.height,
    logoFormat: logo?.format,
  } as any, banks)
  return Buffer.from(deedPdfToBuffer(doc))
}

const fileSafe = (value: string) => value.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** The receipt for one payment on a customer invoice. Null when the invoice is gone. */
export async function paymentReceiptAttachment(input: {
  invoiceId: string
  paymentId: string
  amount: number
  paymentMethod?: string | null
  reference?: string | null
  paidAt?: string | null
}): Promise<EmailAttachment | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, include: { client: true } })
  if (!invoice) return null
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100
  const total = Number(invoice.totalAmount) || 0
  const paid = Number(invoice.amountPaid) || 0
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100)
  const receiptNo = `RCT-${String(input.paymentId).replace(/-/g, '').slice(0, 8).toUpperCase()}`
  const method = input.paymentMethod ? String(input.paymentMethod).replace(/_/g, ' ') : 'Payment'
  const content = await companyPdf({
    title: 'Receipt',
    ref: receiptNo,
    date: (input.paidAt || new Date().toISOString()).slice(0, 10),
    sourceRef: invoice.invoiceNumber,
    customerName: invoice.client?.name || invoice.client?.companyName || 'Customer',
    customerCountry: invoice.client?.country || 'Kenya',
    customerPhone: invoice.client?.phone || undefined,
    customerEmail: invoice.client?.email || undefined,
    partyLabel: 'Received From',
    lines: [{
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      qty: 1,
      unitPrice: amount,
      taxRate: 0,
      subtotal: amount,
    }],
    subtotal: amount,
    taxTotal: 0,
    total: amount,
    // No "Balance due 0" box: the invoice may still have money owing — the notes say how much.
    notes: [
      `Method: ${method}${input.reference ? ` · Ref ${input.reference}` : ''}`,
      `Invoice total: KES ${total.toLocaleString('en-KE')} · Paid to date: KES ${paid.toLocaleString('en-KE')}`,
      balance <= 0.009 ? 'Status: PAID IN FULL' : `Balance remaining: KES ${balance.toLocaleString('en-KE')}`,
    ].join('\n'),
    showPaymentDetails: false,
    showSignature: true,
  }, false)
  return { filename: `Receipt-${fileSafe(invoice.invoiceNumber)}-${receiptNo}.pdf`, content, contentType: 'application/pdf' }
}

/** The RFQ as a PDF the supplier can file or quote against. */
export async function rfqAttachment(rfq: {
  ref: string
  vendorName: string
  expectedDate?: string
  notes?: string
  lines: Array<{ productName: string; qty: number; unitPrice: number; subtotal: number; taxRate?: number }>
  subtotal: number
  taxTotal: number
  total: number
}): Promise<EmailAttachment> {
  const content = await companyPdf({
    title: 'Request for Quotation',
    ref: rfq.ref,
    date: new Date().toISOString().slice(0, 10),
    dueLabel: rfq.expectedDate ? 'Needed By' : undefined,
    dueDate: rfq.expectedDate,
    customerName: rfq.vendorName || 'Supplier',
    customerCountry: 'Kenya',
    partyLabel: 'Supplier',
    lines: rfq.lines.map(l => ({
      description: l.productName,
      qty: Number(l.qty) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      taxRate: Number(l.taxRate) || 0,
      subtotal: Number(l.subtotal) || 0,
    })),
    subtotal: rfq.subtotal,
    taxTotal: rfq.taxTotal,
    total: rfq.total,
    notes: [
      'Please quote your best price, availability, lead time and payment terms for the items above.',
      'Prices shown are our target prices.',
      rfq.notes || '',
    ].filter(Boolean).join('\n'),
    showPaymentDetails: false,
  }, false)
  return { filename: `RFQ-${fileSafe(rfq.ref)}.pdf`, content, contentType: 'application/pdf' }
}
