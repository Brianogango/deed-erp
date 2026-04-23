import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Invoice } from '@/lib/store'

const config = { storeKey: 'deed_invoices', build: () => '' as unknown as Invoice }
export const { PATCH, DELETE } = makeDetailHandlers(config)
