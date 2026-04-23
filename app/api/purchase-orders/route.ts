import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { PurchaseOrder } from '@/lib/store'

const config = {
  storeKey: 'deed_purchaseOrders',
  build: (body: Record<string, unknown>): PurchaseOrder | string => {
    if (!body.vendorName) return 'vendorName is required'
    return {
      id: `po_${Date.now()}`,
      ref: `PO-${Date.now()}`,
      status: 'draft',
      vendorId: String(body.vendorId ?? ''),
      vendorName: String(body.vendorName),
      date: new Date().toISOString().slice(0, 10),
      expectedDate: '',
      lines: [],
      subtotal: 0,
      taxTotal: 0,
      total: 0,
      notes: '',
      ...(body as Partial<PurchaseOrder>),
    } as PurchaseOrder
  },
  filter: (items: PurchaseOrder[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(o => o.status === status)
    if (q) result = result.filter(o =>
      o.ref.toLowerCase().includes(q) || o.vendorName.toLowerCase().includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
