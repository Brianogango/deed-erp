import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Company } from '@/lib/store'

const config = { storeKey: 'deed_companies', build: () => '' as unknown as Company }
export const { PATCH, DELETE } = makeDetailHandlers(config)
