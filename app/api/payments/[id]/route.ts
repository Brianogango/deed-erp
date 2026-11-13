import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Payment } from '@/lib/store'

const config = {
  storeKey: 'deed_payments',
  writePermission: 'recordPayment',
  build: () => '' as unknown as Payment,
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
