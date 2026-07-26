'use client'

import type { ReactNode } from 'react'

/**
 * Single-line truncation with accessible full value via title/tooltip.
 * Prevents cell content from overlapping neighbouring columns.
 */
export function TruncatedText({
  children,
  title,
  className = '',
  as: Tag = 'span',
}: {
  children: ReactNode
  /** Full text for hover / assistive tech. Defaults to string children. */
  title?: string
  className?: string
  as?: 'span' | 'div' | 'p'
}) {
  const tip = title ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined)
  return (
    <Tag className={`erp-truncate ${className}`.trim()} title={tip}>
      {children}
    </Tag>
  )
}
