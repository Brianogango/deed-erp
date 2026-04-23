import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Employee } from '@/lib/store'

const config = { storeKey: 'deed_employees', build: () => '' as unknown as Employee }
export const { PATCH, DELETE } = makeDetailHandlers(config)
