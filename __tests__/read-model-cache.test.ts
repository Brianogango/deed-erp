import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedByFingerprint, clearReadModelCache } from '@/lib/read-model-cache'

describe('cachedByFingerprint', () => {
  beforeEach(() => clearReadModelCache())

  it('builds once while the fingerprint is unchanged', async () => {
    const build = vi.fn(async () => [{ id: 'a' }])
    const fp = async () => 'v1'
    expect(await cachedByFingerprint('t', fp, build)).toEqual([{ id: 'a' }])
    expect(await cachedByFingerprint('t', fp, build)).toEqual([{ id: 'a' }])
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when the fingerprint changes', async () => {
    const build = vi.fn(async () => ({ n: Math.random() }))
    const a = await cachedByFingerprint('t', async () => 'v1', build)
    const b = await cachedByFingerprint('t', async () => 'v2', build)
    expect(build).toHaveBeenCalledTimes(2)
    expect(a).not.toEqual(b)
  })

  it('hands out copies, so a caller editing a result cannot change the cache', async () => {
    type Rows = Array<{ id: string; amountPaid?: number }>
    const fp = async () => 'v1'
    const first = await cachedByFingerprint<Rows>('t', fp, async () => [{ id: 'a', amountPaid: 0 }])
    first[0].amountPaid = 999
    const second = await cachedByFingerprint<Rows>('t', fp, async () => [{ id: 'never' }])
    expect(second).toEqual([{ id: 'a', amountPaid: 0 }])
    second[0].amountPaid = 5
    const third = await cachedByFingerprint<Rows>('t', fp, async () => [{ id: 'never' }])
    expect(third[0].amountPaid).toBe(0)
  })

  it('falls back to a fresh build when the fingerprint cannot be computed', async () => {
    const build = vi.fn(async () => 'fresh')
    const broken = async () => { throw new Error('db down') }
    await cachedByFingerprint('t', broken, build)
    await cachedByFingerprint('t', broken, build)
    expect(build).toHaveBeenCalledTimes(2)
    await cachedByFingerprint('t', async () => '', build)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('keeps separate lists apart', async () => {
    const a = await cachedByFingerprint('invoices', async () => 'x', async () => 'inv')
    const b = await cachedByFingerprint('sales', async () => 'x', async () => 'so')
    expect([a, b]).toEqual(['inv', 'so'])
  })
})
