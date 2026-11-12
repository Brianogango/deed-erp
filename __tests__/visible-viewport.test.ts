import { afterEach, describe, expect, it, vi } from 'vitest'
import { onVisibleViewportChange, visibleViewportBand } from '@/lib/visible-viewport'

type Listener = () => void

function fakeWindow(innerHeight: number, vv?: { height: number; offsetTop: number }) {
  const winListeners = new Map<string, Listener[]>()
  const vvListeners = new Map<string, Listener[]>()
  const add = (m: Map<string, Listener[]>) => (type: string, cb: Listener) => m.set(type, [...(m.get(type) ?? []), cb])
  const remove = (m: Map<string, Listener[]>) => (type: string, cb: Listener) => m.set(type, (m.get(type) ?? []).filter(l => l !== cb))
  const win = {
    innerHeight,
    addEventListener: add(winListeners),
    removeEventListener: remove(winListeners),
    visualViewport: vv
      ? { ...vv, addEventListener: add(vvListeners), removeEventListener: remove(vvListeners) }
      : undefined,
  }
  vi.stubGlobal('window', win)
  return { winListeners, vvListeners }
}

afterEach(() => vi.unstubAllGlobals())

describe('visibleViewportBand', () => {
  it('falls back to innerHeight without visualViewport', () => {
    fakeWindow(800)
    expect(visibleViewportBand()).toEqual({ top: 0, bottom: 800 })
  })

  it('excludes the iOS keyboard, which covers innerHeight without resizing it', () => {
    // 844px layout viewport, keyboard takes 336px, page not scrolled.
    fakeWindow(844, { height: 508, offsetTop: 0 })
    expect(visibleViewportBand()).toEqual({ top: 0, bottom: 508 })
  })

  it('follows the visual viewport when it is scrolled within the layout viewport', () => {
    fakeWindow(844, { height: 508, offsetTop: 120 })
    expect(visibleViewportBand()).toEqual({ top: 120, bottom: 628 })
  })

  it('matches innerHeight on Android resizes-content, where the layout viewport shrinks', () => {
    fakeWindow(500, { height: 500, offsetTop: 0 })
    expect(visibleViewportBand()).toEqual({ top: 0, bottom: 500 })
  })
})

describe('onVisibleViewportChange', () => {
  it('subscribes to window resize and visualViewport resize/scroll, and unsubscribes', () => {
    const { winListeners, vvListeners } = fakeWindow(844, { height: 844, offsetTop: 0 })
    const cb = vi.fn()
    const stop = onVisibleViewportChange(cb)
    winListeners.get('resize')?.forEach(l => l())
    vvListeners.get('resize')?.forEach(l => l())
    vvListeners.get('scroll')?.forEach(l => l())
    expect(cb).toHaveBeenCalledTimes(3)
    stop()
    expect(winListeners.get('resize')).toEqual([])
    expect(vvListeners.get('resize')).toEqual([])
    expect(vvListeners.get('scroll')).toEqual([])
  })
})
