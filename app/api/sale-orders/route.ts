import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { SaleOrder } from '@/lib/store'

const config = {
  storeKey: 'deed_saleOrders',
  allowedWriteRoles: ['director', 'admin_officer', 'sales_rep'],
  build: (body: Record<string, unknown>): SaleOrder | string => {
    if (!body.customerName) return 'customerName is required'
    return {
      id: `so_${Date.now()}`,
      ref: `SO-${Date.now()}`,
      status: 'quotation',
      customerId: String(body.customerId ?? ''),
      customerName: String(body.customerName),
      date: new Date().toISOString().slice(0, 10),
      validUntil: '',
      lines: [],
      subtotal: 0,
      taxTotal: 0,
      total: 0,
      notes: String(body.notes ?? ''),
      ...(body as Partial<SaleOrder>),
    } as SaleOrder
  },
  filter: (items: SaleOrder[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(o => o.status === status)
    if (q) result = result.filter(o =>
      o.ref.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
