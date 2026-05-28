import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Payment } from '@/lib/store'

const config = {
  storeKey: 'deed_payments',
  allowedWriteRoles: ['director', 'finance_officer'],
  build: (body: Record<string, unknown>): Payment | string => {
    if (!body.customerId) return 'customerId is required'
    return { ...body } as Payment
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
