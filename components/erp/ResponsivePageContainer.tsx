'use client'

import type { ReactNode } from 'react'

/**
 * Shared operational page containment. Wide children must provide their own
 * local scroller; the page shell itself must not silently clip controls on
 * phone layouts.
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
      className={`erp-page-container w-full min-w-0 max-w-full ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  )
}
