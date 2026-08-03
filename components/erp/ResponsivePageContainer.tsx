'use client'

import type { ReactNode } from 'react'

/**
 * Full-bleed operational content with consistent page gutters.
 * Tables and list views use the full shell width (no centered max-width).
 */
export function ResponsivePageContainer({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'main'
}) {
  return (
    <Tag className={`erp-page-container ${className}`.trim()}>
      {children}
    </Tag>
  )
}
