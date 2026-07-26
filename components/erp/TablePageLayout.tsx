'use client'

import type { ReactNode } from 'react'

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
}: {
  title?: string
  summary?: ReactNode
  notice?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`erp-table-page ${className}`.trim()}>
      {(title || summary) && (
        <div className="erp-table-page-heading">
          {title && <h2 className="erp-table-page-title">{title}</h2>}
          {summary}
        </div>
      )}
      {notice}
      <div className="erp-table-page-surface">
        {children}
      </div>
    </div>
  )
}
