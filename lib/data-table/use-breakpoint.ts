'use client'

import { useEffect, useState } from 'react'

export type TableBreakpoint = 'mobile' | 'tablet' | 'laptop' | 'desktop'

// Pixel thresholds from docs/DATATABLE_REDESIGN_ARCHITECTURE.md §8–10.
// Deliberately literal px values, not Tailwind's sm/md/lg tokens — the
// column-priority system needs its own scale independent of whatever the
// rest of the app's breakpoints are doing.
export function classifyWidth(width: number): TableBreakpoint {
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  if (width < 1280) return 'laptop'
  return 'desktop'
}

export function useTableBreakpoint(): TableBreakpoint {
  const [breakpoint, setBreakpoint] = useState<TableBreakpoint>('desktop')

  useEffect(() => {
    const sync = () => setBreakpoint(classifyWidth(window.innerWidth))
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return breakpoint
}
