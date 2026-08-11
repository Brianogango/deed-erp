'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

export type TableBreakpoint = 'mobile' | 'tablet' | 'laptop' | 'desktop'

// Pixel thresholds from docs/DATATABLE_REDESIGN_ARCHITECTURE.md §8–10.
// Deliberately literal px values, not Tailwind's sm/md/lg tokens — the
// column-priority system needs its own scale independent of whatever the
// rest of the app's breakpoints are doing.
export function classifyWidth(width: number): TableBreakpoint {
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  if (width < 1440) return 'laptop'
  return 'desktop'
}

/**
 * Hysteresis around each boundary so ResizeObserver scrollbar/layout flips
 * near 768/1024/1440 do not thrash table ↔ cards (visual "shake").
 */
export function classifyWidthWithHysteresis(
  width: number,
  previous: TableBreakpoint,
  pad = 20,
): TableBreakpoint {
  const boundaries: Array<{ from: TableBreakpoint; to: TableBreakpoint; at: number }> = [
    { from: 'mobile', to: 'tablet', at: 768 },
    { from: 'tablet', to: 'laptop', at: 1024 },
    { from: 'laptop', to: 'desktop', at: 1440 },
  ]
  // Stay on previous until we clearly cross the pad away from the boundary.
  for (const b of boundaries) {
    if (previous === b.from && width >= b.at && width < b.at + pad) return previous
    if (previous === b.to && width < b.at && width >= b.at - pad) return previous
  }
  return classifyWidth(width)
}

function resolveAvailableWidth(containerRef?: RefObject<HTMLElement | null>): number {
  if (typeof window === 'undefined') return 1440

  const viewportWidth = window.innerWidth
  const containerWidth = containerRef?.current?.getBoundingClientRect().width
  // Always prefer the table's actual container width. Anchoring to viewport
  // ignored the sidebar/padding and kept "desktop" column sets that forced
  // horizontal scroll inside a ~900px content pane.
  if (containerWidth && !Number.isNaN(containerWidth) && containerWidth > 0) {
    return Math.max(0, Math.floor(containerWidth))
  }

  return viewportWidth
}

export function useTableBreakpoint(containerRef?: RefObject<HTMLElement | null>): TableBreakpoint {
  const [breakpoint, setBreakpoint] = useState<TableBreakpoint>('desktop')
  const previousRef = useRef<TableBreakpoint>('desktop')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const sync = () => {
      const width = resolveAvailableWidth(containerRef)
      const next = classifyWidthWithHysteresis(width, previousRef.current)
      if (next === previousRef.current) return
      previousRef.current = next
      setBreakpoint(next)
    }
    sync()

    window.addEventListener('resize', sync)

    let observer: ResizeObserver | null = null
    const node = containerRef?.current
    if (node && 'ResizeObserver' in window) {
      observer = new ResizeObserver(sync)
      observer.observe(node)
    }

    // Re-sync on next frame in case the ref attached after first paint.
    const raf = window.requestAnimationFrame(sync)

    return () => {
      window.removeEventListener('resize', sync)
      observer?.disconnect()
      window.cancelAnimationFrame(raf)
    }
  }, [containerRef])

  return breakpoint
}
