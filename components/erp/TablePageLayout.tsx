'use client'

import { useId, type ReactNode } from 'react'

/**
 * Standard operational list page body. The surface stays width-contained but
 * does not clip descendants; DataTable/local scrollers own horizontal overflow.
 */
export function TablePageLayout({
  title,
  summary,
  notice,
  children,
  className = '',
  ariaLabel,
}: {
  title?: string
  summary?: ReactNode
  notice?: ReactNode
  children: ReactNode
  className?: string
  ariaLabel?: string
}) {
  const generatedId = useId().replace(/:/g, '')
  const headingId = title ? `erp-table-page-${generatedId}` : undefined

  return (
    <section
      className={`erp-table-page w-full min-w-0 max-w-full ${className}`.trim()}
      aria-labelledby={headingId}
      aria-label={!headingId ? ariaLabel : undefined}
    >
      {(title || summary) && (
        <div className="erp-table-page-heading min-w-0">
          {title && <h2 id={headingId} className="erp-table-page-title">{title}</h2>}
          {summary}
        </div>
      )}
      {notice}
      <div className="erp-table-page-surface min-w-0 max-w-full">
        {children}
      </div>
    </section>
  )
}
