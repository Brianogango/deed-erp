import { afterEach, describe, expect, it, vi } from 'vitest'
import { startVisiblePoll, VISIBLE_POLL_MS } from '@/lib/visible-poll'

describe('startVisiblePoll', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ticks immediately when visible and skips while hidden', () => {
    vi.useFakeTimers()
    const visibility = { state: 'visible' as DocumentVisibilityState }
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
    const add = (target: string) => (type: string, fn: EventListenerOrEventListenerObject) => {
      const key = `${target}:${type}`
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(fn)
    }
    const remove = (target: string) => (type: string, fn: EventListenerOrEventListenerObject) => {
      listeners.get(`${target}:${type}`)?.delete(fn)
    }

    vi.stubGlobal('document', {
      get visibilityState() { return visibility.state },
      addEventListener: add('document'),
      removeEventListener: remove('document'),
    })
    vi.stubGlobal('window', {
      setInterval: (handler: TimerHandler, ms?: number) => globalThis.setInterval(handler, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => globalThis.clearInterval(id),
      addEventListener: add('window'),
      removeEventListener: remove('window'),
    })

    const fn = vi.fn()
    const stop = startVisiblePoll(fn, 1_000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    expect(fn).toHaveBeenCalledTimes(2)

    visibility.state = 'hidden'
    vi.advanceTimersByTime(1_000)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('defaults to a one-minute interval', () => {
    expect(VISIBLE_POLL_MS).toBe(60_000)
  })
})
