import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { RepairOrder } from '@/lib/store'

const config = {
  storeKey: 'deed_repairs_v2',
  build: (body: Record<string, unknown>): RepairOrder | string => {
    if (!body.customerName) return 'customerName is required'
    if (!body.productName) return 'productName is required'
    return {
      id: `rep_${Date.now()}`,
      ref: `REP-${Date.now()}`,
      status: 'intake',
      customerId: String(body.customerId ?? ''),
      customerName: String(body.customerName),
      customerPhone: String(body.customerPhone ?? ''),
      productId: String(body.productId ?? ''),
      productName: String(body.productName),
      serialNumber: String(body.serialNumber ?? ''),
      intakeChannel: 'walk_in',
      intakeDate: new Date().toISOString().slice(0, 10),
      intakeNotes: '',
      issueDescription: String(body.issueDescription ?? ''),
      accessories: [],
      ...(body as Partial<RepairOrder>),
    } as RepairOrder
  },
  filter: (items: RepairOrder[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(r => r.status === status)
    if (q) result = result.filter(r =>
      r.ref.toLowerCase().includes(q) ||
      r.customerName.toLowerCase().includes(q) ||
      r.productName.toLowerCase().includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
