'use client'

/**
 * Root-layout error UI. `app/error.tsx` cannot catch failures inside the root
 * layout (AppShell / StoreProvider). Without this file, those exceptions
 * render as a blank white page in production.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F4F6FB' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 420,
              width: '100%',
              borderRadius: 16,
              border: '1px solid #E2E8F0',
              background: '#fff',
              padding: 32,
              textAlign: 'center',
              boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
            }}
          >
            <h1 style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.5 }}>
              The app hit an unexpected error while loading your workspace. Reloading usually fixes it.
              If it keeps happening, clear site data for this domain and sign in again.
            </p>
            {error?.digest && (
              <p style={{ fontSize: 10, color: '#94A3B8', marginTop: 8, fontFamily: 'ui-monospace, monospace' }}>
                Ref: {error.digest}
              </p>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem('deed_stale_build_reloaded')
                  } catch { /* ignore */ }
                  window.location.reload()
                }}
                style={{
                  padding: '8px 20px',
                  borderRadius: 12,
                  border: 'none',
                  background: '#1B2762',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Reload page
              </button>
              <button
                type="button"
                onClick={reset}
                style={{
                  padding: '8px 20px',
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  background: '#fff',
                  color: '#334155',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
