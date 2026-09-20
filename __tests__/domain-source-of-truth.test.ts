import { describe, expect, it } from 'vitest'
import { DOMAIN_PERSISTENCE, DOMAIN_SOURCE_OF_TRUTH, isPrismaRestSotStoreKey, PRISMA_REST_SOT_STORE_KEYS } from '@/lib/domain-source-of-truth'

describe('domain source of truth', () => {
  it('marks CRM/HR catalog keys as Prisma REST write-skip', () => {
    expect(PRISMA_REST_SOT_STORE_KEYS).toContain('deed_quotes')
    expect(PRISMA_REST_SOT_STORE_KEYS).toContain('deed_contacts')
    expect(isPrismaRestSotStoreKey('deed_quotes')).toBe(true)
    expect(isPrismaRestSotStoreKey('deed_saleOrders')).toBe(false)
    expect(isPrismaRestSotStoreKey('deed_products')).toBe(false)
    expect(isPrismaRestSotStoreKey('deed_repairs_v2')).toBe(false)
  })

  it('uses Prisma for every registered operational domain', () => {
    expect(new Set(Object.values(DOMAIN_SOURCE_OF_TRUTH))).toEqual(new Set(['prisma']))
    expect(DOMAIN_PERSISTENCE.sale_orders).toBe('normalized')
    expect(DOMAIN_PERSISTENCE.purchase_orders).toBe('row_projection')
    expect(DOMAIN_PERSISTENCE.serials).toBe('row_projection')
    expect(DOMAIN_PERSISTENCE.receipts).toBe('row_projection')
  })
})
