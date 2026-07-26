'use client'

import type { ReactNode } from 'react'

/**
 * Constrains operational content to the ERP max width with consistent gutters.
 * Tables may still use the full container width inside.
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
