'use client'

// Branded commercial document PDFs (quotations, sales orders, pro-forma
// invoices, invoices, bills, receipts) generated client-side with jsPDF.
// Visual shell matches the Deed Technologies downloadable invoice template
// and is shared with portal/server PDFs via lib/deed-document-pdf.

import type { jsPDF } from 'jspdf'
import type { BankAccount, CompanySettings } from '@/lib/store'
import {
  buildDeedDocumentPdf,
  type DeedPdfInput,
} from '@/lib/deed-document-pdf'

export interface CommercialPdfLine {
  lineType?: 'item' | 'section'
  description: string
  qty: number
  unitPrice: number
  taxRate?: number
  discountPct?: number
  subtotal: number
  serial?: string
  specs?: string
}

export interface CommercialPdfInput {
  /** e.g. "Quotation", "Sale Order", "Pro-forma Invoice", "Invoice", "Bill", "Receipt", "Delivery Note" */
  title: string
  ref: string
  date?: string
  /** Label for the second date column, e.g. "Expiration" or "Due Date". */
  dueLabel?: string
  dueDate?: string
  salesperson?: string
  sourceRef?: string
  customerName: string
  customerAddress?: string
  customerCountry?: string
  customerTaxId?: string
  customerPhone?: string
  attention?: string
  recipientIdNumber?: string
  /** Override the party heading, e.g. "Invoice To", "Quote To", "Receipt To". */
  partyLabel?: string
  lines: CommercialPdfLine[]
  /** Prefer document currency snapshot over company display currency. */
  currency?: string
  subtotal: number
  /** Sum of per-line discounts (shown on PDF totals when &gt; 0). */
  discountTotal?: number
  taxTotal: number
  total: number
  amountPaid?: number
  notes?: string
  /** Invoices: highlight payment communication / reference. */
  paymentCommunication?: boolean
  /** Hide unit prices / totals (delivery-style). */
  hideAmounts?: boolean
  /** Delivery-note columns: Serial / Specs / Cond. */
  deliveryNoteLayout?: boolean
  showReceiptAcknowledgement?: boolean
  /** Show bank / M-Pesa block (default true unless hideAmounts). */
  showPaymentDetails?: boolean
  /** Show authorised signature block (default true). */
  showSignature?: boolean
  /**
   * Pre-built payment detail lines (reference, selected banks, M-Pesa, note).
   * When set, overrides the default first-bank + company M-Pesa block.
   */
  paymentDetailLines?: string[]
}

/** Load the company logo (uploaded data URL or same-origin URL) for jsPDF. */
async function loadLogo(logoUrl?: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!logoUrl || typeof window === 'undefined') return null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      const timer = window.setTimeout(() => reject(new Error('logo timeout')), 4000)
      el.onload = () => { window.clearTimeout(timer); resolve(el) }
      el.onerror = () => { window.clearTimeout(timer); reject(new Error('logo failed')) }
      el.src = logoUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1
    canvas.height = img.naturalHeight || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

export async function buildCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
): Promise<jsPDF> {
  const logo = await loadLogo(company.logoUrl)
  const deedInput: DeedPdfInput = {
    title: input.title,
    ref: input.ref,
    date: input.date,
    dueLabel: input.dueLabel,
    dueDate: input.dueDate,
    salesperson: input.salesperson,
    sourceRef: input.sourceRef,
    customerName: input.customerName,
    customerAddress: input.customerAddress,
    customerCountry: input.customerCountry,
    customerTaxId: input.customerTaxId,
    customerPhone: input.customerPhone,
    attention: input.attention,
    recipientIdNumber: input.recipientIdNumber,
    partyLabel: input.partyLabel,
    lines: input.lines,
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    taxTotal: input.taxTotal,
    total: input.total,
    amountPaid: input.amountPaid,
    notes: input.notes,
    paymentCommunication: input.paymentCommunication,
    hideAmounts: input.hideAmounts,
    deliveryNoteLayout: input.deliveryNoteLayout,
    showReceiptAcknowledgement: input.showReceiptAcknowledgement,
    showPaymentDetails: input.showPaymentDetails,
    showSignature: input.showSignature,
    paymentDetailLines: input.paymentDetailLines,
  }

  return buildDeedDocumentPdf(
    deedInput,
    {
      name: company.name,
      address: company.address,
      city: company.city,
      phone: company.phone,
      email: company.email,
      website: company.website,
      kraPin: company.kraPin,
      currency: input.currency || company.currency,
      mpesaPaybill: company.mpesaPaybill,
      mpesaAccount: company.mpesaAccount,
      invoiceFooter: company.invoiceFooter,
      logoDataUrl: logo?.dataUrl,
      logoWidth: logo?.width,
      logoHeight: logo?.height,
    },
    bankAccounts,
  )
}

const safeFileName = (name: string) => name.replace(/[/\\]/g, '-')

export async function downloadCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
  fileName?: string,
) {
  const doc = await buildCommercialPdf(input, company, bankAccounts)
  doc.save(safeFileName(fileName ?? `${input.title} - ${input.ref}.pdf`))
}

/** Open the PDF in a new tab (customer preview / print). */
export async function openCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
): Promise<boolean> {
  const doc = await buildCommercialPdf(input, company, bankAccounts)
  const url = doc.output('bloburl')
  const win = window.open(url, '_blank')
  return Boolean(win)
}
