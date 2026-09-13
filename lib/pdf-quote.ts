'use client'

import { downloadCommercialPdf } from './commercial-pdf'
import { getStoredCompanyData, getStoredBankAccounts } from './company'
import type { Quote } from './store'
import { normalizeDocumentBackground, normalizeDocumentFont, normalizeDocumentLayout, normalizeHexColor, normalizePaperFormat } from './document-layout'

/** Download a CRM quote using the shared Deed commercial document template. */
export const downloadQuotePdf = async (quote: Quote) => {
  const co = getStoredCompanyData()
  const banks = getStoredBankAccounts().map(b => ({
    ...b,
    currency: 'KES',
    openingBalance: 0,
    openingDate: '',
    active: true,
  }))

  await downloadCommercialPdf(
    {
      title: 'Quotation',
      ref: quote.ref,
      date: quote.issueDate,
      dueLabel: 'Valid Until',
      dueDate: quote.validUntil,
      salesperson: quote.ownerName,
      customerName: quote.companyName,
      customerCountry: 'Kenya',
      partyLabel: 'Quote To',
      lines: quote.lines.map(line => ({
        description: `${line.productName}${line.sku ? ` (${line.sku})` : ''}`,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        subtotal: line.lineTotal,
      })),
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      total: quote.total,
      notes: [
        quote.paymentTerms ? `Payment Terms: ${quote.paymentTerms}` : '',
        quote.deliveryTerms ? `Delivery Terms: ${quote.deliveryTerms}` : '',
        quote.warranty ? `Warranty: ${quote.warranty}` : '',
        // Internal workflow lines are stripped in buildDeedDocumentPdf.
        quote.notes ?? '',
      ].filter(Boolean).join('\n') || undefined,
      paymentCommunication: true,
      currency: quote.currencyCode || 'KES',
    },
    {
      name: co.name,
      address: co.address,
      city: co.city,
      phone: co.phone,
      email: co.email,
      website: co.website,
      kraPin: co.kraPin,
      vatRate: 16,
      mpesaPaybill: co.mpesaPaybill,
      mpesaAccount: co.mpesaAccount,
      logoUrl: co.logoUrl,
      currency: quote.currencyCode || 'KES',
      invoiceFooter: co.invoiceFooter || 'Thank you for your business.',
      printTemplate: normalizeDocumentLayout(co.printTemplate),
      printFont: normalizeDocumentFont(co.printFont),
      printBackground: normalizeDocumentBackground(co.printBackground),
      printPrimaryColor: normalizeHexColor(co.printPrimaryColor, '#714B67'),
      printSecondaryColor: normalizeHexColor(co.printSecondaryColor, '#017E84'),
      printTagline: co.printTagline,
      printPaperFormat: normalizePaperFormat(co.printPaperFormat),
    },
    banks as any,
    `Quotation - ${quote.ref}.pdf`,
  )
}

/** @deprecated Prefer downloadQuotePdf — kept for callers that still build line arrays. */
export const buildQuotePdfLines = () => []
export const createQuotePdfBlob = async (quote: Quote) => {
  // Compatibility shim: trigger the branded download path.
  await downloadQuotePdf(quote)
  return new Blob()
}
