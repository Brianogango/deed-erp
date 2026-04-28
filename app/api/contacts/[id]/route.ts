import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Contact } from '@/lib/store'

const config = { storeKey: 'deed_contacts', allowedWriteRoles: ['director', 'admin_officer', 'sales_rep', 'finance_officer'], build: () => '' as unknown as Contact }
export const { PATCH, DELETE } = makeDetailHandlers(config)
