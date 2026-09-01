'use client'

import { useId, type ReactNode } from 'react'

/**
 * Standard operational list page body (below ModuleHeader + TabBar):
 * title/summary → optional notice → table surface (toolbar + records + pagination).
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
      <div className="erp-table-page-surface min-w-0 max-w-full overflow-x-hidden">
        {children}
      </div>
    </section>
  )
}
