import { describe, expect, it } from 'vitest'
import {
  PRISMA_READ_INVENTORY_KEYS,
  inventoryPrismaReadsEnabled,
} from '@/lib/inventory/prisma-read'
import { domainRoleFor, isDualWriteKey } from '@/lib/blob-cutover'

describe('inventory Prisma-first reads', () => {
  it('covers all dual-write inventory keys', () => {
    for (const key of PRISMA_READ_INVENTORY_KEYS) {
      expect(isDualWriteKey(key)).toBe(true)
      expect(domainRoleFor(key)).toBe('dual_write')
    }
  })

  it('defaults Prisma reads ON unless INVENTORY_PRISMA_READ=0', () => {
    const prev = process.env.INVENTORY_PRISMA_READ
    delete process.env.INVENTORY_PRISMA_READ
    expect(inventoryPrismaReadsEnabled()).toBe(true)
    process.env.INVENTORY_PRISMA_READ = '0'
    expect(inventoryPrismaReadsEnabled()).toBe(false)
    process.env.INVENTORY_PRISMA_READ = '1'
    expect(inventoryPrismaReadsEnabled()).toBe(true)
    if (prev === undefined) delete process.env.INVENTORY_PRISMA_READ
    else process.env.INVENTORY_PRISMA_READ = prev
  })
})
