'use client'

import { useEffect } from 'react'

// Stale-deploy signatures: a tab from a previous build failing to load chunks
// or RSC payloads from the new one. A single reload fixes these — do it
// automatically instead of showing users a dead "Application error" screen.
const STALE_BUILD_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /clientModules/,
  /Unexpected token '<'/,
]

function isStaleBuildError(error: Error): boolean {
  const text = `${error.name}: ${error.message}`
  return STALE_BUILD_PATTERNS.some(re => re.test(text))
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app-error-boundary]', error)
    if (!isStaleBuildError(error)) return
    // Reload once per session to pick up the new build; the guard prevents a
    // reload loop if the error persists after refreshing.
    try {
      if (!sessionStorage.getItem('deed_stale_build_reloaded')) {
        sessionStorage.setItem('deed_stale_build_reloaded', '1')
        window.location.reload()
      }
    } catch { /* storage unavailable — fall through to the manual screen */ }
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-page, #F4F6FB)' }}>
      <div className="max-w-md w-full rounded-2xl border border-[var(--border-lt,#E2E8F0)] bg-white p-8 text-center shadow-sm">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl flex items-center justify-center text-xl"
          style={{ background: '#FEF3C7', color: '#B45309' }}>
          !
        </div>
        <h1 className="text-base font-extrabold text-[var(--text-1,#0F172A)]">Something went wrong</h1>
        <p className="text-xs text-[var(--text-3,#64748B)] mt-2 leading-relaxed">
          This usually happens when a new version of the app was released while this tab was open.
          Reloading normally fixes it.
        </p>
        {error?.digest && (
          <p className="text-[10px] text-[var(--text-4,#94A3B8)] mt-2 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center mt-6">
          <button
            onClick={() => { try { sessionStorage.removeItem('deed_stale_build_reloaded') } catch {}; window.location.reload() }}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white"
            style={{ background: '#1B2762' }}
          >
            Reload page
          </button>
          <button
            onClick={reset}
            className="px-5 py-2 rounded-xl text-xs font-bold border border-[var(--border-lt,#E2E8F0)] text-[var(--text-2,#334155)]"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
