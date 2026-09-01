'use client'

import type { ReactNode } from 'react'

/**
 * Recoverable page/section error state. Keeps entered form data in the parent and
 * gives the user a clear next action instead of replacing the screen with raw errors.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  retry,
  retryLabel = 'Try again',
  action,
  className = '',
}: {
  title?: string
  description?: ReactNode
  retry?: () => void
  retryLabel?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-bg)] px-4 py-4 ${className}`.trim()}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-[var(--danger)]"
          aria-hidden="true"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--text-1)]">{title}</h3>
          {description && <div className="mt-1 text-xs leading-5 text-[var(--text-3)]">{description}</div>}
          {(retry || action) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {retry && (
                <button type="button" className="btn-outline erp-action-btn" onClick={retry}>
                  {retryLabel}
                </button>
              )}
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
