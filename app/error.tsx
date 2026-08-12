'use client'

import { useEffect } from 'react'
import { recoverClientOnce, resetClientRecoveryFlag, isRecoverableClientError } from '@/lib/client-recovery'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app-error-boundary]', error)
    if (!isRecoverableClientError(error)) return
    void recoverClientOnce(`app-error:${error.name}:${error.message}`)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-page)]">
      <div className="max-w-md w-full rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-8 text-center shadow-sm">
        <div
          className="w-12 h-12 mx-auto mb-4 rounded-2xl flex items-center justify-center text-xl bg-[var(--warning-bg)] text-[var(--warning)]"
        >
          !
        </div>
        <h1 className="text-base font-extrabold text-[var(--text-1)]">Something went wrong</h1>
        <p className="text-xs text-[var(--text-3)] mt-2 leading-relaxed">
          This usually happens after an app update or when local browser data got out of sync.
          Repair &amp; reload clears the local cache and signs you back into a clean workspace.
        </p>
        {error?.digest && (
          <p className="text-[10px] text-[var(--text-4)] mt-2 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center mt-6">
          <button
            onClick={() => {
              resetClientRecoveryFlag()
              void recoverClientOnce('app-error:manual')
            }}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-[var(--navy)]"
          >
            Repair &amp; reload
          </button>
          <button
            onClick={reset}
            className="px-5 py-2 rounded-xl text-xs font-bold border border-[var(--border-lt)] text-[var(--text-2)]"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
