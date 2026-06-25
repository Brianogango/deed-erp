'use client'

import { useEffect, useState, type RefObject } from 'react'

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

function resolveAvailableWidth(containerRef?: RefObject<HTMLElement | null>): number {
  if (typeof window === 'undefined') return 1440

  const viewportWidth = window.innerWidth
  const containerWidth = containerRef?.current?.getBoundingClientRect().width
  if (!containerWidth || Number.isNaN(containerWidth)) return viewportWidth

  return Math.max(0, Math.min(viewportWidth, Math.floor(containerWidth)))
}

export function useTableBreakpoint(containerRef?: RefObject<HTMLElement | null>): TableBreakpoint {
  const [breakpoint, setBreakpoint] = useState<TableBreakpoint>('desktop')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const sync = () => setBreakpoint(classifyWidth(resolveAvailableWidth(containerRef)))
    sync()

    window.addEventListener('resize', sync)

    let observer: ResizeObserver | null = null
    if (containerRef?.current && 'ResizeObserver' in window) {
      observer = new ResizeObserver(sync)
      observer.observe(containerRef.current)
    }

    return () => {
      window.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [containerRef])

  return breakpoint
}
