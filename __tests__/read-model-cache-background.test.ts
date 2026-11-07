import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedByFingerprint, clearReadModelCache } from '@/lib/read-model-cache'

describe('age limit on an unchanged list', () => {
  beforeEach(() => { clearReadModelCache(); vi.useFakeTimers({ toFake: ['Date'] }) })
  afterEach(() => vi.useRealTimers())

  it('answers with the stored list at once and rebuilds behind it', async () => {
    let n = 0
    let release!: () => void
    const build = vi.fn(async () => {
      n += 1
      if (n === 2) await new Promise<void>(r => { release = r })
      return { n }
    })
    const fp = async () => 'v1'
    expect(await cachedByFingerprint('j', fp, build)).toEqual({ n: 1 })

    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    // Past the age limit: no waiting for the slow rebuild.
    expect(await cachedByFingerprint('j', fp, build)).toEqual({ n: 1 })
    expect(build).toHaveBeenCalledTimes(2)
    // A request during the refresh does not start another.
    expect(await cachedByFingerprint('j', fp, build)).toEqual({ n: 1 })
    expect(build).toHaveBeenCalledTimes(2)

    release()
    await new Promise(r => setTimeout(r, 0))
    expect(await cachedByFingerprint('j', fp, build)).toEqual({ n: 2 })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('a real change still waits for the new list', async () => {
    const build = vi.fn(async () => ({ at: Math.random() }))
    const a = await cachedByFingerprint('j', async () => 'v1', build)
    const b = await cachedByFingerprint('j', async () => 'v2', build)
    expect(a).not.toEqual(b)
  })
})
