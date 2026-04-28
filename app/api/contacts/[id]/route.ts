import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Contact } from '@/lib/store'

const config = { storeKey: 'deed_contacts', allowedWriteRoles: ['admin', 'sales_rep', 'finance'], build: () => '' as unknown as Contact }
export const { PATCH, DELETE } = makeDetailHandlers(config)
