import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Invoice } from '@/lib/store'

const config = {
  storeKey: 'deed_invoices',
  build: (body: Record<string, unknown>): Invoice | string => {
    if (!body.partnerName) return 'partnerName is required'
    return {
      id: `inv_${Date.now()}`,
      ref: `INV-${Date.now()}`,
      type: 'customer_invoice',
      status: 'draft',
      partnerId: String(body.partnerId ?? ''),
      partnerName: String(body.partnerName),
      date: new Date().toISOString().slice(0, 10),
      dueDate: '',
      lines: [],
      subtotal: 0,
      taxTotal: 0,
      total: 0,
      amountPaid: 0,
      notes: '',
      ...(body as Partial<Invoice>),
    } as Invoice
  },
  filter: (items: Invoice[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const type = params.get('type')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(i => i.status === status)
    if (type) result = result.filter(i => i.type === type)
    if (q) result = result.filter(i =>
      i.ref.toLowerCase().includes(q) || i.partnerName.toLowerCase().includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
