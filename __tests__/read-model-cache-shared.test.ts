import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedByFingerprint, clearReadModelCache, incrementalRows, withSharedReadModels } from '@/lib/read-model-cache'

beforeEach(() => clearReadModelCache())
afterEach(() => vi.useRealTimers())

describe('read-only callers share the stored list', () => {
  it('returns the same stored list inside withSharedReadModels, copies outside', async () => {
    const build = vi.fn(async () => [{ id: 'a' }])
    const fp = async () => 'v1'
    await cachedByFingerprint('t', fp, build)
    const a = await withSharedReadModels(() => cachedByFingerprint('t', fp, build))
    const b = await withSharedReadModels(() => cachedByFingerprint('t', fp, build))
    expect(a).toBe(b)
    const c = await cachedByFingerprint('t', fp, build)
    expect(c).not.toBe(a)
    expect(c).toEqual(a)
    c[0].id = 'changed'
    expect((await withSharedReadModels(() => cachedByFingerprint('t', fp, build)))[0].id).toBe('a')
  })

  it('a caller that changes its first-build result cannot change the stored list', async () => {
    const first = await cachedByFingerprint('t', async () => 'v1', async () => [{ id: 'a' }])
    first[0].id = 'changed'
    const again = await cachedByFingerprint('t', async () => 'v1', async () => [{ id: 'never' }])
    expect(again[0].id).toBe('a')
  })

  it('rebuilds after 10 minutes even when the fingerprint did not move', async () => {
    vi.useFakeTimers()
    const build = vi.fn(async () => [{ id: 'a' }])
    await cachedByFingerprint('t', async () => 'v1', build)
    vi.advanceTimersByTime(9 * 60 * 1000)
    await cachedByFingerprint('t', async () => 'v1', build)
    expect(build).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2 * 60 * 1000)
    await cachedByFingerprint('t', async () => 'v1', build)
    expect(build).toHaveBeenCalledTimes(2)
  })
})

describe('incrementalRows', () => {
  const run = (sigs: Array<{ id: string; sig: string }>, rows: Record<string, string>, base = 'b1') => {
    const load = vi.fn(async (ids: string[] | null) =>
      new Map(Object.entries(rows).filter(([id]) => !ids || ids.includes(id)).map(([id, v]) => [id, { id, v }])))
    return { load, result: incrementalRows({ name: 'x', base, signatures: async () => sigs, load }) }
  }

  it('re-reads only changed rows and keeps signature order', async () => {
    await run([{ id: 'a', sig: '1' }, { id: 'b', sig: '1' }], { a: 'A', b: 'B' }).result
    const second = run([{ id: 'b', sig: '2' }, { id: 'a', sig: '1' }], { a: 'A2', b: 'B2' })
    expect(await second.result).toEqual([{ id: 'b', v: 'B2' }, { id: 'a', v: 'A' }])
    expect(second.load).toHaveBeenCalledWith(['b'])
  })

  it('reads everything when the base changes', async () => {
    await run([{ id: 'a', sig: '1' }], { a: 'A' }).result
    const second = run([{ id: 'a', sig: '1' }], { a: 'A2' }, 'b2')
    expect(await second.result).toEqual([{ id: 'a', v: 'A2' }])
    expect(second.load).toHaveBeenCalledWith(null)
  })
})
