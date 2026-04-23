import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Contact } from '@/lib/store'

const config = { storeKey: 'deed_contacts', build: () => '' as unknown as Contact }
export const { PATCH, DELETE } = makeDetailHandlers(config)
