import { Invoice, SaleOrder, Contact, CompanySettings, BankAccount } from '@/lib/store'
import { findRepairForInvoice, withDeviceHeading, withRepairDeviceSection, type RepairDeviceLike } from '@/lib/repair-invoice-device-section'
import { displayDocRef, invoiceDocState } from '@/lib/odoo-sales-flow'
import {
  buildCommercialPdf,
  downloadCommercialPdf,
  type CommercialPdfInput,
} from '@/lib/commercial-pdf'
import {
  buildPaymentDetailLines,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import { customerFacingNotes } from '@/lib/customer-facing-notes'
import { fetchDocumentWarranties } from '@/lib/warranty/client'

/** Warranty lines for a customer invoice (machines sold on it). None for bills or drafts. */
async function withWarranties(inv: Invoice, input: CommercialPdfInput): Promise<CommercialPdfInput> {
  if (inv.type !== 'customer_invoice' || invoiceDocState(inv.status) !== 'posted') return input
  const list = await fetchDocumentWarranties({ invoiceId: inv.id })
  if (!list.length) return input
  return { ...input, warranties: list.map(w => ({ ref: w.ref, productName: w.productName, serialNumber: w.serialNumber, endDate: w.endDate, months: w.months, url: w.checkUrl })) }
}

const isCustomerInvoice = (inv: Invoice) => inv.type === 'customer_invoice'

/**
 * The device heading for a repair invoice, from the server when this page has
 * not loaded the repair. The Finance screens never load the repair list, so
 * without this the heading appeared only for someone who had opened Repairs
 * earlier in the session. A failed lookup just leaves the PDF without it.
 */
async function withServerDeviceHeading(inv: Invoice, input: CommercialPdfInput): Promise<CommercialPdfInput> {
  if (!isCustomerInvoice(inv) || input.lines.some(l => l.lineType === 'section')) return input
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(inv.id)}/repair-device`, { cache: 'no-store' })
    if (!res.ok) return input
    const body = await res.json().catch(() => null) as { heading?: string | null } | null
    return body?.heading ? { ...input, lines: withDeviceHeading(input.lines, body.heading) } : input
  } catch {
    return input
  }
}

/** Map an invoice onto the shared Odoo-style PDF input. */
function invoicePdfInput(
  inv: Invoice,
  saleOrders: SaleOrder[],
  contacts: Contact[] = [],
  paymentDetails?: Partial<DocumentPaymentDetails> | null,
  company?: Pick<CompanySettings, 'name' | 'mpesaPaybill' | 'mpesaAccount' | 'currency'>,
  bankAccounts: BankAccount[] = [],
  repairs: RepairDeviceLike[] = [],
): CommercialPdfInput {
  const so = saleOrders?.find(s => s.id === inv.saleOrderId)
  const repair = isCustomerInvoice(inv) ? findRepairForInvoice(inv, repairs, so?.repairId) : undefined
  const contact = contacts.find(c => c.id === inv.partnerId)
  const paymentCommunication = isCustomerInvoice(inv) && invoiceDocState(inv.status) === 'posted'
  const base: CommercialPdfInput = {
    // VAT remains itemised in the totals, but the customer-facing document
    // name is consistently "Invoice" rather than switching to "Tax Invoice".
    title: isCustomerInvoice(inv) ? 'Invoice' : 'Bill',
    ref: displayDocRef(inv.ref),
    date: inv.date,
    dueLabel: 'Due Date',
    dueDate: inv.dueDate,
    sourceRef: so?.ref || (inv as Invoice & { saleOrderRef?: string }).saleOrderRef || undefined,
    customerPoNumber: inv.customerPoNumber || undefined,
    customerName: inv.partnerName,
    customerAddress: inv.invoiceAddress || [contact?.address, contact?.city, contact?.country].filter(Boolean).join(', ') || undefined,
    customerCountry: contact?.country || 'Kenya',
    customerPhone: contact?.phone || contact?.mobile || undefined,
    customerEmail: contact?.email || undefined,
    customerTaxId: contact?.vatNumber || undefined,
    // A repair invoice is headed by the device the work was done on.
    lines: withRepairDeviceSection(inv.lines.map(l => ({
      lineType: l.lineType,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      discountPct: l.discountPct,
      subtotal: l.subtotal,
    })), repair),
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
    notes: customerFacingNotes(inv.notes) || undefined,
    // Odoo prints the payment communication on posted customer invoices.
    paymentCommunication,
    // Vendor bills do not show customer payment instructions.
    showPaymentDetails: isCustomerInvoice(inv),
  }

  if (isCustomerInvoice(inv) && company) {
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
  repairs: RepairDeviceLike[] = [],
) {
  const input = await withServerDeviceHeading(inv, await withWarranties(inv, invoicePdfInput(inv, saleOrders, contacts, paymentDetails, companySettings, bankAccounts, repairs)))
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
  repairs: RepairDeviceLike[] = [],
): Promise<{ pdfBase64: string; pdfFilename: string }> {
  const input = await withServerDeviceHeading(inv, await withWarranties(inv, invoicePdfInput(inv, saleOrders, contacts, paymentDetails, companySettings, bankAccounts, repairs)))
  const doc = await buildCommercialPdf(input, companySettings, bankAccounts)
  const dataUri = doc.output('datauristring')
  return {
    pdfBase64: dataUri.slice(dataUri.indexOf('base64,') + 'base64,'.length),
    pdfFilename: `${input.title} - ${input.ref}.pdf`.replace(/[/\\]/g, '-'),
  }
}
