import { afterEach, describe, expect, it, vi } from 'vitest'
import { startVisiblePoll, VISIBLE_POLL_MS } from '@/lib/visible-poll'

describe('startVisiblePoll', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks immediately when visible and skips while hidden', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    const stop = startVisiblePoll(fn, 1_000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    expect(fn).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    vi.advanceTimersByTime(1_000)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('defaults to a one-minute interval', () => {
    expect(VISIBLE_POLL_MS).toBe(60_000)
  })
})
