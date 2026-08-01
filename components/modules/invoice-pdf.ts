import { Invoice, SaleOrder, Contact, CompanySettings, BankAccount } from '@/lib/store'
import { displayDocRef, invoiceDocState } from '@/lib/odoo-sales-flow'
import {
  buildCommercialPdf,
  downloadCommercialPdf,
  openCommercialPdf,
  type CommercialPdfInput,
} from '@/lib/commercial-pdf'

/** Map an invoice onto the shared Odoo-style PDF input. */
export function invoicePdfInput(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[] = [],
): CommercialPdfInput {
  const so = saleOrders?.find(s => s.id === inv.saleOrderId)
  const contact = contacts.find(c => c.id === inv.partnerId)
  const isCustomerInvoice = inv.type === 'customer_invoice'
  return {
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
    discountTotal: inv.lines.reduce((sum, l) => {
      const pct = Number(l.discountPct) || 0
      if (pct <= 0) return sum
      const gross = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0)
      return sum + Math.round(gross * pct) / 100
    }, 0),
    taxTotal: inv.taxTotal,
    total: inv.total,
    amountPaid: inv.amountPaid,
    notes: inv.notes,
    // Odoo prints the payment communication on posted customer invoices.
    paymentCommunication: isCustomerInvoice && invoiceDocState(inv.status) === 'posted',
  }
}

export async function downloadInvoicePdf(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[],
) {
  const input = invoicePdfInput(inv, saleOrders, contacts)
  await downloadCommercialPdf(input, companySettings, bankAccounts, `${input.title} - ${input.ref}.pdf`)
}

/** Base64 PDF payload for the invoice email attachment. */
export async function invoicePdfBase64(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[],
): Promise<{ pdfBase64: string; pdfFilename: string }> {
  const input = invoicePdfInput(inv, saleOrders, contacts)
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
): Promise<boolean> {
  return openCommercialPdf(invoicePdfInput(inv, saleOrders, contacts), companySettings, bankAccounts)
}

export { buildCommercialPdf }
