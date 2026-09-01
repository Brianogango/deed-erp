'use client'

import type { ReactNode } from 'react'

/**
 * Phone-only action dock for detail workflows. Keep it compact and limited to
 * one primary action plus, at most, one secondary action; desktop action
 * clusters must not be reproduced here.
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
      className={`erp-mobile-action-bar fixed z-30 md:hidden ${className}`.trim()}
      style={{ paddingBottom: 'max(0.45rem, env(safe-area-inset-bottom))' }}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="erp-mobile-action-bar__inner mx-auto flex w-full max-w-xl items-center">
        {secondary && <div className="min-w-0 flex-1">{secondary}</div>}
        <div className="min-w-0 flex-[1.35]">{primary}</div>
      </div>
    </div>
  )
}
