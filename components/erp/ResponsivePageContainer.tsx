'use client'

import type { ReactNode } from 'react'

/**
 * Full-bleed operational content with consistent responsive containment.
 * The min-width/overflow guards prevent one wide child from pushing the
 * entire ERP shell sideways on phone and tablet viewports.
 */
export function ResponsivePageContainer({
  children,
  className = '',
  as: Tag = 'div',
  ariaLabel,
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'main'
  ariaLabel?: string
}) {
  return (
    <Tag
      className={`erp-page-container w-full min-w-0 max-w-full overflow-x-hidden ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  )
}
