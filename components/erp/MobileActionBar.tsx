'use client'

import type { ReactNode } from 'react'

/**
 * Phone-first action dock for record/detail screens.
 * Keeps the one primary action reachable near the thumb zone while allowing
 * one secondary action without recreating desktop button clusters on mobile.
 */
export function MobileActionBar({
  primary,
  secondary,
  className = '',
  ariaLabel = 'Record actions',
}: {
  primary: ReactNode
  secondary?: ReactNode
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--bg-card)]/95 px-3 pt-2 backdrop-blur md:hidden ${className}`.trim()}
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="mx-auto flex w-full max-w-xl items-center gap-2 [&_button]:min-h-11 [&_a]:min-h-11">
        {secondary && <div className="min-w-0 flex-1">{secondary}</div>}
        <div className="min-w-0 flex-[1.35]">{primary}</div>
      </div>
    </div>
  )
}
