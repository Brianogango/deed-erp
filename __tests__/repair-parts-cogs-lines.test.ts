import { describe, expect, it } from 'vitest'
import { resolveConsumedLines } from '@/app/api/repairs/[id]/parts-cogs/route'

const repair = {
  partsUsed: [
    { productId: 'prod-a', qty: 2, reservedDate: '2026-09-24' },
    { productId: 'prod-b', qty: 1, reservedDate: '2026-09-24' },
  ],
}

describe('resolveConsumedLines', () => {
  it('posts the lines the caller names even though the stored copy has no usedDate yet', () => {
    // This is the bug: QC stamps usedDate locally and syncs afterwards, so the
    // server's repair still shows the parts unconsumed while the POST is in
    // flight. Filtering on usedDate found nothing and no journal was written.
    const { lines } = resolveConsumedLines(repair, [
      { productId: 'prod-a', qty: 2 },
      { productId: 'prod-b', qty: 1 },
    ])
    expect(lines).toEqual([
      { productId: 'prod-a', qty: 2 },
      { productId: 'prod-b', qty: 1 },
    ])
  })

  it('rejects a product the repair never recorded', () => {
    const { lines, rejected } = resolveConsumedLines(repair, [
      { productId: 'prod-a', qty: 1 },
      { productId: 'not-on-this-repair', qty: 9 },
    ])
    expect(lines).toEqual([{ productId: 'prod-a', qty: 1 }])
    expect(rejected).toEqual(['not-on-this-repair'])
  })

  it('clamps a quantity to what the repair recorded', () => {
    const { lines } = resolveConsumedLines(repair, [{ productId: 'prod-b', qty: 500 }])
    expect(lines).toEqual([{ productId: 'prod-b', qty: 1 }])
  })

  it('falls back to stored usedDate when no lines are named (backfill / retry)', () => {
    const { lines } = resolveConsumedLines({
      partsUsed: [
        { productId: 'prod-a', qty: 2, usedDate: '2026-09-20' },
        { productId: 'prod-b', qty: 1 },
      ],
    })
    expect(lines).toEqual([{ productId: 'prod-a', qty: 2 }])
  })

  it('returns nothing when the repair has no parts at all', () => {
    expect(resolveConsumedLines({}, [{ productId: 'prod-a', qty: 1 }]).lines).toEqual([])
    expect(resolveConsumedLines({}).lines).toEqual([])
  })
})
