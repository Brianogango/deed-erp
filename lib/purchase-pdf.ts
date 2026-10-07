/**
 * Purchase RFQ / PO PDFs using the same Deed commercial document shell as invoices.
 */

import type { Contact, CompanySettings, PurchaseOrder } from '@/lib/store'
import { purchaseDocType } from '@/lib/purchases-filter'
import {
  downloadCommercialPdf,
  type CommercialPdfInput,
} from '@/lib/commercial-pdf'

type PurchasePdfKind = 'rfq' | 'po'

export function purchasePdfKind(po: Pick<PurchaseOrder, 'status'>): PurchasePdfKind {
  return purchaseDocType(po.status)
}

/** Map a purchase order onto the shared invoice-style PDF input. */
export function purchaseOrderPdfInput(
  po: PurchaseOrder,
  contacts: Contact[] = [],
  kind: PurchasePdfKind = purchasePdfKind(po),
): CommercialPdfInput {
  const vendor = contacts.find(c => c.id === po.vendorId)
  const isRfq = kind === 'rfq'
  const address = [vendor?.address, vendor?.city, vendor?.country].filter(Boolean).join(', ')

  const defaultNotes = isRfq
    ? 'Please quote availability, lead time, payment terms, and final pricing for the items below.'
    : undefined
  const notes = [po.notes?.trim(), defaultNotes].filter(Boolean).join('\n\n') || undefined

  return {
    title: isRfq ? 'Request for Quotation' : 'Purchase Order',
    ref: po.ref,
    date: po.date,
    dueLabel: 'Expected',
    dueDate: po.expectedDate,
    sourceRef: po.repairRef,
    customerName: po.vendorName,
    customerAddress: address || undefined,
    customerCountry: vendor?.country || 'Kenya',
    customerTaxId: vendor?.vatNumber || undefined,
    customerPhone: vendor?.phone || vendor?.mobile || undefined,
    partyLabel: 'Vendor',
    lines: (po.lines || []).map(l => ({
      description: [l.productName, l.specs].filter(Boolean).join(' — ') || 'Item',
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      subtotal: l.subtotal,
    })),
    subtotal: po.subtotal,
    taxTotal: po.taxTotal,
    total: po.total,
    notes,
    // Purchase docs never print customer payment / bank instructions.
    showPaymentDetails: false,
    showSignature: true,
  }
}

async function downloadPurchasePdf(
  po: PurchaseOrder,
  contacts: Contact[],
  companySettings: CompanySettings,
  kind: PurchasePdfKind = purchasePdfKind(po),
) {
  const input = purchaseOrderPdfInput(po, contacts, kind)
  const filename = `${kind === 'rfq' ? 'RFQ' : 'PO'} - ${input.ref}.pdf`
  await downloadCommercialPdf(input, companySettings, [], filename)
}

export async function downloadRfqPdf(
  po: PurchaseOrder,
  contacts: Contact[],
  companySettings: CompanySettings,
) {
  return downloadPurchasePdf(po, contacts, companySettings, 'rfq')
}

export async function downloadPoPdf(
  po: PurchaseOrder,
  contacts: Contact[],
  companySettings: CompanySettings,
) {
  return downloadPurchasePdf(po, contacts, companySettings, 'po')
}
