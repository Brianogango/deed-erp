import { makeCollectionHandlers } from '@/lib/server-store-crud'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import type { Receipt } from '@/lib/store'

const config = {
  storeKey: 'deed_receipts',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  prepareCreate: async (body: Record<string, unknown>) => {
    if (!body.ref) body.ref = await getNextDocNumber('receipt')
    return body
  },
  build: (body: Record<string, unknown>): Receipt | string => {
    if (!body.vendorId) return 'vendorId is required'
    return { ...body } as unknown as Receipt
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
