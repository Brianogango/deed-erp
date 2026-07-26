'use client'

import { useState, type ReactNode } from 'react'

/**
 * Compact one–two line notice above operational tables.
 * Replaces tall coloured banners.
 */
export function CompactInfoNotice({
  children,
  dismissible = false,
  storageKey,
}: {
  children: ReactNode
  dismissible?: boolean
  /** Persist dismissal in localStorage when set. */
  storageKey?: string
}) {
  const [hidden, setHidden] = useState(() => {
    if (!dismissible || !storageKey || typeof window === 'undefined') return false
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })

  if (hidden) return null

  return (
    <div className="erp-info-notice" role="note">
      <span className="erp-info-notice-icon" aria-hidden="true">ℹ</span>
      <p className="erp-info-notice-text">{children}</p>
      {dismissible && (
        <button
          type="button"
          className="erp-info-notice-dismiss"
          aria-label="Dismiss notice"
          onClick={() => {
            setHidden(true)
            if (storageKey) {
              try { localStorage.setItem(storageKey, '1') } catch { /* ignore */ }
            }
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
