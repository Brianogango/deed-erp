'use client'

import { useEffect, useState } from 'react'

const CHECK_INTERVAL_MS = 300_000 // 5 min

/**
 * Stale-tab guard. Every deploy changes the server build id; a tab loaded
 * before the deploy keeps running old code indefinitely (its chunk URLs still
 * resolve because deploys carry old hashed assets forward), which has surfaced
 * as "impossible" UI states — old toasts, dead buttons, missing fixes.
 *
 * The page's own build id arrives in the HTML as <body data-build=…>; the
 * server's current build id comes from /api/version. On mismatch: background
 * tabs reload silently (the store re-hydrates from the server, so nothing is
 * lost), a visible tab gets a dismissible refresh banner.
 */
export default function VersionDriftBanner() {
  const [drifted, setDrifted] = useState(false)

  useEffect(() => {
    const loadedBuild = document.body.dataset.build
    if (!loadedBuild || loadedBuild === 'dev' || loadedBuild === 'unknown') return

    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as { buildId?: unknown } | null
        const serverBuild = typeof data?.buildId === 'string' ? data.buildId : ''
        if (!serverBuild || serverBuild === 'dev' || serverBuild === 'unknown') return
        if (serverBuild === loadedBuild || cancelled) return
        if (document.hidden) {
          window.location.reload()
          return
        }
        setDrifted(true)
      } catch {
        /* offline — try again next interval */
      }
    }

    void check()
    const id = window.setInterval(check, CHECK_INTERVAL_MS)
    const onVisible = () => { if (!document.hidden) void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!drifted) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[9700] flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 shadow-lg"
    >
      <p className="text-xs font-semibold text-[var(--text-1)]">
        A new version of Deed ERP is available.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-primary px-3 py-1.5 text-[11px]"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={() => setDrifted(false)}
        aria-label="Dismiss"
        className="text-sm leading-none text-[var(--text-4)] hover:text-[var(--text-2)]"
      >
        ×
      </button>
    </div>
  )
}
