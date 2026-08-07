import { Invoice, SaleOrder, Contact, CompanySettings, BankAccount } from '@/lib/store'
import { displayDocRef, invoiceDocState } from '@/lib/odoo-sales-flow'
import {
  buildCommercialPdf,
  downloadCommercialPdf,
  openCommercialPdf,
  type CommercialPdfInput,
} from '@/lib/commercial-pdf'
import {
  buildPaymentDetailLines,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'

/** Map an invoice onto the shared Odoo-style PDF input. */
export function invoicePdfInput(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[] = [],
  paymentDetails?: Partial<DocumentPaymentDetails> | null,
  company?: Pick<CompanySettings, 'name' | 'mpesaPaybill' | 'mpesaAccount' | 'currency'>,
  bankAccounts: BankAccount[] = [],
): CommercialPdfInput {
  const so = saleOrders?.find(s => s.id === inv.saleOrderId)
  const contact = contacts.find(c => c.id === inv.partnerId)
  const isCustomerInvoice = inv.type === 'customer_invoice'
  const paymentCommunication = isCustomerInvoice && invoiceDocState(inv.status) === 'posted'
  const base: CommercialPdfInput = {
    title: isCustomerInvoice ? 'Invoice' : 'Bill',
    ref: displayDocRef(inv.ref),
    date: inv.date,
    dueLabel: 'Due Date',
    dueDate: inv.dueDate,
    sourceRef: so?.ref,
    customerName: inv.partnerName,
    customerAddress: inv.invoiceAddress || [contact?.address, contact?.city, contact?.country].filter(Boolean).join(', ') || undefined,
    customerCountry: contact?.country || 'Kenya',
    customerTaxId: contact?.vatNumber || undefined,
    lines: inv.lines.map(l => ({
      lineType: l.lineType,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      discountPct: l.discountPct,
      subtotal: l.subtotal,
    })),
    subtotal: inv.subtotal,
    // Pre-tax line discounts (manually-entered invoices, e.g. Accounting.tsx's
    // invoice form, which sets discountPct per line) — distinct from the
    // header-level, post-tax discountAmount below (invoices created from a
    // discounted Sales Order via create-invoice).
    discountTotal: inv.lines.reduce((sum, l) => {
      const pct = Number(l.discountPct) || 0
      if (pct <= 0) return sum
      const gross = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0)
      return sum + Math.round(gross * pct) / 100
    }, 0),
    postTaxDiscountTotal: Number(inv.discountAmount) || 0,
    taxTotal: inv.taxTotal,
    total: inv.total,
    amountPaid: inv.amountPaid,
    notes: inv.notes,
    // Odoo prints the payment communication on posted customer invoices.
    paymentCommunication,
    // Vendor bills do not show customer payment instructions.
    showPaymentDetails: isCustomerInvoice,
  }

  if (isCustomerInvoice && company) {
    base.paymentDetailLines = buildPaymentDetailLines({
      details: paymentDetails,
      company,
      bankAccounts,
      documentRef: displayDocRef(inv.ref),
      paymentCommunication,
    })
  }

  return base
}

export async function downloadInvoicePdf(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[],
  paymentDetails?: Partial<DocumentPaymentDetails> | null,
) {
  const input = invoicePdfInput(inv, saleOrders, contacts, paymentDetails, companySettings, bankAccounts)
  await downloadCommercialPdf(input, companySettings, bankAccounts, `${input.title} - ${input.ref}.pdf`)
}

/** Base64 PDF payload for the invoice email attachment. */
export async function invoicePdfBase64(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[],
  paymentDetails?: Partial<DocumentPaymentDetails> | null,
): Promise<{ pdfBase64: string; pdfFilename: string }> {
  const input = invoicePdfInput(inv, saleOrders, contacts, paymentDetails, companySettings, bankAccounts)
  const doc = await buildCommercialPdf(input, companySettings, bankAccounts)
  const dataUri = doc.output('datauristring')
  return {
    pdfBase64: dataUri.slice(dataUri.indexOf('base64,') + 'base64,'.length),
    pdfFilename: `${input.title} - ${input.ref}.pdf`.replace(/[/\\]/g, '-'),
  }
}

export async function openInvoicePdf(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[],
  paymentDetails?: Partial<DocumentPaymentDetails> | null,
): Promise<boolean> {
  return openCommercialPdf(
    invoicePdfInput(inv, saleOrders, contacts, paymentDetails, companySettings, bankAccounts),
    companySettings,
    bankAccounts,
  )
}

export { buildCommercialPdf }
