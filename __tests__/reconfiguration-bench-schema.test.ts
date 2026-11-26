import { describe, it, expect } from 'vitest'
import { applyBenchSchema } from '@/lib/reconfiguration/schemas'

const id = () => crypto.randomUUID()

// The bench screen sends moduleCount 0 for a slot left as-is when the unit has
// no installed-parts record (e.g. RAM swap, SSD "Leave as-is"). That used to
// reject the whole job with "Validation failed".
describe('applyBenchSchema moduleCount', () => {
  const ramSwap = { action: 'swap', moduleCount: 1, outgoingProductId: id(), incomingProductId: id(), incomingCapacityGb: 8 }

  it('accepts a slot left as-is with count 0, blank or null', () => {
    for (const moduleCount of [0, '', null]) {
      const r = applyBenchSchema.safeParse({ serialId: 's1', ram: ramSwap, storage: { action: 'none', moduleCount, storageType: 'SSD' } })
      expect(r.success, String(moduleCount)).toBe(true)
      if (r.success) expect(r.data.storage.moduleCount).toBeUndefined()
    }
  })

  it('still rejects impossible counts', () => {
    for (const moduleCount of [5, -1, 1.5]) {
      const r = applyBenchSchema.safeParse({ serialId: 's1', ram: { ...ramSwap, moduleCount } })
      expect(r.success, String(moduleCount)).toBe(false)
    }
  })

  it('keeps real counts', () => {
    const r = applyBenchSchema.safeParse({ serialId: 's1', ram: { ...ramSwap, moduleCount: 2 } })
    expect(r.success && r.data.ram.moduleCount).toBe(2)
  })
})
