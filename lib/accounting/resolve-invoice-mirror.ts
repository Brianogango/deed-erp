import 'server-only'
import { loadAppState } from '@/lib/server-store'

export type BlobInvoiceType = 'customer_invoice' | 'vendor_bill'

export type BlobInvoiceMirror = {
  type: BlobInvoiceType
  status?: string
  purchaseOrderId?: string
  partnerName?: string
  clientName?: string
  postedByUserId?: string | null
  lines?: Array<{
    productId?: string
    qty?: number
    unitPrice?: number
    subtotal?: number
    accountCode?: string
    description?: string
  }>
}

/**
 * Resolve invoice type / PO linkage from the deed_invoices blob mirror.
 * Prisma Invoice rows do not store customer vs vendor; vendor bills dual-write
 * through the same table when a PO is attached.
 */
export async function resolveBlobInvoiceMirror(invoiceId: string): Promise<BlobInvoiceMirror> {
  try {
    const state = await loadAppState(['deed_invoices'])
    const invoices = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
    const mirror = invoices.find(i => i.id === invoiceId)
    if (!mirror) {
      return { type: 'customer_invoice' }
    }
    const type: BlobInvoiceType = mirror.type === 'vendor_bill' ? 'vendor_bill' : 'customer_invoice'
    const purchaseOrderId = typeof mirror.purchaseOrderId === 'string' && mirror.purchaseOrderId
      ? mirror.purchaseOrderId
      : undefined
    const partnerName = typeof mirror.partnerName === 'string' ? mirror.partnerName : undefined
    const clientName = typeof mirror.clientName === 'string' ? mirror.clientName : undefined
    const postedByUserId = typeof mirror.postedByUserId === 'string' ? mirror.postedByUserId : null
    const status = typeof mirror.status === 'string' ? mirror.status : undefined
    const lines = Array.isArray(mirror.lines) ? mirror.lines as BlobInvoiceMirror['lines'] : undefined
    return { type, status, purchaseOrderId, partnerName, clientName, postedByUserId, lines }
  } catch {
    return { type: 'customer_invoice' }
  }
}
