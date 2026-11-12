'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onVisibleViewportChange, visibleViewportBand } from '@/lib/visible-viewport'

/**
 * Phones (and short landscape phones): pickers become a bottom sheet instead of
 * an anchored popover. Width-only + coarse-height query, so the software keyboard
 * opening (which changes height, not width) never flips the mode mid-interaction.
 */
export const COMPACT_PICKER_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)'

export function useCompactViewport(query: string = COMPACT_PICKER_QUERY): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}

/**
 * The part of the screen the user can actually see. On iOS the keyboard covers
 * the layout viewport without resizing it; on Android (interactive-widget=
 * resizes-content) the layout viewport shrinks. `keyboardInset` is how far the
 * bottom of the visible area sits above the layout viewport's bottom.
 */
export function useVisibleViewport(active: boolean) {
  const [state, setState] = useState({ height: 0, keyboardInset: 0 })
  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    const sync = () => {
      const band = visibleViewportBand()
      const height = band.bottom - band.top
      const keyboardInset = Math.max(0, window.innerHeight - band.bottom)
      setState(prev => (prev.height === height && prev.keyboardInset === keyboardInset ? prev : { height, keyboardInset }))
    }
    sync()
    return onVisibleViewportChange(sync)
  }, [active])
  return state
}

const EXIT_MS = 320

// Apple's scroll-deceleration projection: where a flick would come to rest.
function project(velocityPxPerSec: number, decelerationRate = 0.998) {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate)
}

/**
 * Bottom sheet for search-and-pick lists on phones. It follows the visible
 * viewport so the keyboard never covers the results, never closes because the
 * page resized or scrolled, and can be dismissed by dragging the grabber down,
 * tapping the dimmed backdrop, Escape, or the Done button.
 */
export default function PickerSheet({
  open,
  onClose,
  title,
  children,
  panelRef,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Receives the sheet panel, so callers' outside-tap handlers can ignore taps inside it. */
  panelRef?: MutableRefObject<HTMLDivElement | null>
  footer?: ReactNode
}) {
  const titleId = useId()
  // Mounted while open, and for EXIT_MS after closing so it can slide away.
  // `rendered` is derived (not set in an effect) so the panel mounts in the
  // same commit as the tap that opened it — see the focus effect below.
  const [exiting, setExiting] = useState(false)
  const [shown, setShown] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const rendered = open || exiting
  const localPanel = useRef<HTMLDivElement | null>(null)
  const lastChildren = useRef<ReactNode>(children)
  const lastFooter = useRef<ReactNode>(footer)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const drag = useRef<{ startY: number; samples: { y: number; t: number }[]; pointerId: number } | null>(null)
  const { height: vvHeight, keyboardInset } = useVisibleViewport(rendered)

  // Keep the last content on screen while the sheet slides away.
  if (open) {
    lastChildren.current = children
    lastFooter.current = footer
  }

  // Focus the search field during the opening tap's commit: iOS only raises the
  // keyboard for focus() that runs inside the user gesture. preventScroll stops
  // the browser jumping the page toward the still-offscreen sheet.
  useLayoutEffect(() => {
    if (!open || wasOpen.current) return
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    localPanel.current?.querySelector<HTMLElement>('[data-sheet-autofocus]')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      setExiting(false)
      setDragY(0)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    setShown(false)
    setExiting(true)
    const t = window.setTimeout(() => {
      setExiting(false)
      const el = restoreFocus.current
      if (el && el.isConnected) el.focus({ preventScroll: true })
    }, EXIT_MS)
    return () => window.clearTimeout(t)
  }, [open])

  // Lock page scroll behind the sheet.
  useEffect(() => {
    if (!rendered) return
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [rendered])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const setPanel = useCallback((node: HTMLDivElement | null) => {
    localPanel.current = node
    if (panelRef) panelRef.current = node
  }, [panelRef])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY - dragY, samples: [{ y: e.clientY, t: performance.now() }], pointerId: e.pointerId }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const raw = e.clientY - d.startY
    // Down tracks 1:1; up rubber-bands — there is nothing above the top detent.
    const next = raw >= 0 ? raw : -((-raw * 60) / (60 + -raw * 0.55))
    setDragY(next)
    d.samples.push({ y: e.clientY, t: performance.now() })
    if (d.samples.length > 6) d.samples.shift()
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    const first = d.samples[0]
    const last = d.samples[d.samples.length - 1]
    const dt = Math.max(1, last.t - first.t)
    const velocity = ((last.y - first.y) / dt) * 1000
    const sheetHeight = localPanel.current?.offsetHeight ?? 400
    const projected = dragY + project(velocity)
    if (dragY > 0 && (projected > sheetHeight * 0.45 || velocity > 900)) {
      onClose()
    } else {
      setDragY(0)
    }
  }

  if (!rendered || typeof document === 'undefined') return null

  const keyboardOpen = keyboardInset > 80
  const available = vvHeight || (typeof window !== 'undefined' ? window.innerHeight : 640)
  // Large detent: almost the whole visible area, leaving a sliver of the page
  // above so it still reads as a sheet over the quotation.
  const sheetHeight = Math.max(240, available - (keyboardOpen ? 8 : 44))
  const offscreen = !shown || !open
  const translate = offscreen ? '100%' : `${Math.max(dragY, -24)}px`

  return createPortal(
    <div className="picker-sheet-root" data-open={open && shown ? 'true' : 'false'}>
      <div className="picker-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`picker-sheet${dragging ? ' is-dragging' : ''}`}
        style={{
          bottom: keyboardInset,
          height: sheetHeight,
          transform: `translate3d(0, ${translate}, 0)`,
        }}
      >
        <div
          className="picker-sheet-header"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="picker-sheet-grabber" aria-hidden="true" />
          <div className="picker-sheet-titlebar">
            <h2 id={titleId} className="picker-sheet-title">{title}</h2>
            <button type="button" className="picker-sheet-done" onClick={onClose}>Done</button>
          </div>
        </div>
        <div className="picker-sheet-body">{lastChildren.current}</div>
        {lastFooter.current ? <div className="picker-sheet-footer">{lastFooter.current}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
