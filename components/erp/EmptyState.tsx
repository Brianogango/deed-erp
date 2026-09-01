'use client'

import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action,
  icon,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-6 py-10 text-center ${className}`.trim()}>
      {icon && <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--bg-muted)] text-[var(--text-3)]" aria-hidden="true">{icon}</div>}
      <h3 className="text-sm font-semibold text-[var(--text-1)]">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-4)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
