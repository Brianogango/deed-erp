import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedByFingerprint, changedParts, clearReadModelCache } from '@/lib/read-model-cache'

describe('read model cache', () => {
  beforeEach(() => clearReadModelCache())

  it('requests arriving together share one build', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const build = vi.fn(async () => { await gate; return [{ id: 1 }] })
    const calls = [1, 2, 3].map(() => cachedByFingerprint('x', async () => 'fp1', build))
    release()
    const results = await Promise.all(calls)
    expect(build).toHaveBeenCalledTimes(1)
    expect(results.every(r => r.length === 1)).toBe(true)
    // each caller gets its own copy
    results[0][0].id = 99
    expect(results[1][0].id).toBe(1)
  })

  it('a new fingerprint builds again; the same one reuses', async () => {
    const build = vi.fn(async () => ['v'])
    await cachedByFingerprint('y', async () => 'a', build)
    await cachedByFingerprint('y', async () => 'a', build)
    await cachedByFingerprint('y', async () => 'b', build)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('a failed build is not kept and the next request retries', async () => {
    const build = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(['ok'])
    await expect(cachedByFingerprint('z', async () => 'a', build)).rejects.toThrow('db down')
    await expect(cachedByFingerprint('z', async () => 'a', build)).resolves.toEqual(['ok'])
  })

  it('names the fingerprint parts that changed', () => {
    expect(changedParts(undefined, 'a|b')).toBe('first build')
    expect(changedParts('a|b|c', 'a|x|c')).toBe('part 2')
    expect(changedParts('a|b|c', 'z|b|y')).toBe('part 1,3')
  })
})
