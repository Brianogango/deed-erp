'use client'

/**
 * Delivery Note PDF — uses the shared Deed commercial document template
 * (same downloadable jsPDF shell as quotations / invoices), with delivery
 * columns: SL / Item / Qty / Serial / Specs / Cond. and receipt acknowledgement.
 */

import type { BankAccount, CompanySettings, Delivery, Product, SerialNumber } from '@/lib/store'
import { deliveryDeliveredTotal, effectiveDeliveryLineQty } from '@/lib/odoo-sales-flow'
import {
  downloadCommercialPdf,
  type CommercialPdfInput,
  type CommercialPdfLine,
} from '@/lib/commercial-pdf'

export interface DnPrintOptions {
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
}

export interface DnProductRef {
  id: string
  description?: string
  name?: string
}

/**
 * Resolve specs for a shipped unit:
 * configuration display name (at-sale snapshot) → serial.specs → product.description → accessories.
 */
export function resolveDeliveryUnitSpecs(
  serial?: Pick<SerialNumber, 'specs' | 'accessories' | 'accessoryNotes'> | null,
  product?: Pick<DnProductRef, 'description'> | null,
  configurationDisplayName?: string | null,
): string {
  const fromSnapshot = configurationDisplayName?.trim()
  if (fromSnapshot) return fromSnapshot

  const fromSerial = serial?.specs?.trim()
  if (fromSerial) return fromSerial

  const fromProduct = product?.description?.trim()
  if (fromProduct) return fromProduct

  const accessories = (serial?.accessories ?? []).map(a => String(a).trim()).filter(Boolean)
  if (accessories.length) return accessories.join(', ')

  return serial?.accessoryNotes?.trim() || ''
}

/** Build commercial-PDF lines for a delivery (one row per serial when present). */
export function buildDeliveryNoteLines(
  delivery: Delivery,
  serials: SerialNumber[],
  products: DnProductRef[] = [],
): CommercialPdfLine[] {
  const lines: CommercialPdfLine[] = []
  const productById = new Map(products.map(p => [p.id, p]))

  for (const line of delivery.lines) {
    const shippedQty = effectiveDeliveryLineQty(line)
    const product = productById.get(line.productId)
    const fallbackSpecs = resolveDeliveryUnitSpecs(null, product)

    if (line.serialIds && line.serialIds.length > 0) {
      const serialSlice = line.serialIds.slice(0, Math.max(shippedQty, line.serialIds.length))
      for (const sid of serialSlice) {
        const ser = serials.find(s => s.id === sid)
        lines.push({
          description: line.productName,
          qty: 1,
          unitPrice: 0,
          subtotal: 0,
          serial: ser?.serial || ser?.barcode || sid,
          specs: resolveDeliveryUnitSpecs(ser, product) || fallbackSpecs,
        })
      }
      continue
    }

    if (shippedQty <= 0) continue
    lines.push({
      description: line.productName,
      qty: shippedQty,
      unitPrice: 0,
      subtotal: 0,
      serial: '',
      specs: fallbackSpecs,
    })
  }

  return lines
}

export function buildDeliveryNotePdfInput(
  delivery: Delivery,
  serials: SerialNumber[],
  options: DnPrintOptions = {},
  products: DnProductRef[] = [],
): CommercialPdfInput {
  const recipientName = options.recipientName || delivery.recipientName || ''
  const recipientPhone = options.recipientPhone || delivery.recipientPhone || ''
  const recipientIdNumber = options.recipientIdNumber || delivery.recipientIdNumber || ''
  const deliveryAddress = options.deliveryAddress || delivery.deliveryAddress || ''
  const notes = options.notes || delivery.notes || ''

  return {
    title: 'Delivery Note',
    ref: delivery.ref,
    date: delivery.date,
    sourceRef: delivery.saleOrderRef || undefined,
    customerName: delivery.customerName,
    customerAddress: deliveryAddress || undefined,
    customerCountry: deliveryAddress ? undefined : 'Kenya',
    customerPhone: recipientPhone || undefined,
    attention: recipientName || undefined,
    recipientIdNumber: recipientIdNumber || undefined,
    partyLabel: 'Deliver To',
    lines: buildDeliveryNoteLines(delivery, serials, products),
    subtotal: 0,
    taxTotal: 0,
    total: 0,
    notes: notes || undefined,
    hideAmounts: true,
    deliveryNoteLayout: true,
    showReceiptAcknowledgement: true,
    showPaymentDetails: false,
    showSignature: true,
  }
}

/**
 * Download the Delivery Note as a branded Deed commercial PDF.
 * Returns false when delivered qty is 0 or generation fails.
 */
export async function downloadDeliveryNotePdf(
  delivery: Delivery,
  serials: SerialNumber[],
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
  options: DnPrintOptions = {},
  products: Array<Pick<Product, 'id' | 'description' | 'name'> | DnProductRef> = [],
): Promise<boolean> {
  if (deliveryDeliveredTotal(delivery) <= 0) {
    if (typeof window !== 'undefined') {
      window.alert('Cannot download Delivery Note — delivered quantity is 0. Enter quantities or assign serials first.')
    }
    return false
  }
  try {
    const input = buildDeliveryNotePdfInput(delivery, serials, options, products)
    await downloadCommercialPdf(input, company, bankAccounts, `Delivery Note - ${delivery.ref}.pdf`)
    return true
  } catch (err) {
    console.error('Delivery Note PDF failed', err)
    if (typeof window !== 'undefined') {
      window.alert('Delivery Note PDF could not be generated. Please try again.')
    }
    return false
  }
}

/** @deprecated Prefer downloadDeliveryNotePdf — kept for call-site compatibility during migration. */
export async function printDeliveryNote(
  delivery: Delivery,
  serials: SerialNumber[],
  options: DnPrintOptions = {},
  company?: CompanySettings,
  bankAccounts: BankAccount[] = [],
  products: DnProductRef[] = [],
): Promise<boolean> {
  if (!company) {
    console.error('printDeliveryNote requires company settings for the commercial PDF template')
    return false
  }
  return downloadDeliveryNotePdf(delivery, serials, company, bankAccounts, options, products)
}
