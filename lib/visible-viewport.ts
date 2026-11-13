/**
 * The band of the layout viewport the user can actually see, in the same
 * coordinates getBoundingClientRect() uses.
 *
 * Android (interactive-widget=resizes-content) shrinks the layout viewport when
 * the keyboard opens, so window.innerHeight is already right there. iOS Safari
 * does not: the keyboard covers the bottom of the layout viewport and only
 * visualViewport shrinks. Anchored menus that measured against innerHeight
 * therefore opened "below" the field — straight under the keyboard.
 */
export function visibleViewportBand(): { top: number; bottom: number } {
  if (typeof window === 'undefined') return { top: 0, bottom: 0 }
  const vv = window.visualViewport
  if (!vv) return { top: 0, bottom: window.innerHeight }
  const top = Math.max(0, vv.offsetTop)
  return { top, bottom: Math.min(window.innerHeight, top + vv.height) }
}

/** Subscribe to every event that moves the visible band (keyboard, pinch-zoom, scroll). */
export function onVisibleViewportChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const vv = window.visualViewport
  window.addEventListener('resize', cb)
  vv?.addEventListener('resize', cb)
  vv?.addEventListener('scroll', cb)
  return () => {
    window.removeEventListener('resize', cb)
    vv?.removeEventListener('resize', cb)
    vv?.removeEventListener('scroll', cb)
  }
}
