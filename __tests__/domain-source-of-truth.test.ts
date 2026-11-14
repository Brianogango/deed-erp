import { describe, expect, it } from 'vitest'
import { isPrismaRestSotStoreKey, PRISMA_REST_SOT_STORE_KEYS } from '@/lib/domain-source-of-truth'

describe('domain source of truth', () => {
  it('marks CRM/HR catalog keys as Prisma REST write-skip', () => {
    expect(PRISMA_REST_SOT_STORE_KEYS).toContain('deed_quotes')
    expect(PRISMA_REST_SOT_STORE_KEYS).toContain('deed_contacts')
    expect(isPrismaRestSotStoreKey('deed_quotes')).toBe(true)
    expect(isPrismaRestSotStoreKey('deed_saleOrders')).toBe(false)
    expect(isPrismaRestSotStoreKey('deed_products')).toBe(false)
    expect(isPrismaRestSotStoreKey('deed_repairs_v2')).toBe(false)
  })

  })
