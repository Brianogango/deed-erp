/** Full-viewport chrome placeholder so the first paint is never a blank screen. */
export function ShellChromeSkeleton() {
  return (
    <div
      className="flex h-screen w-full overflow-hidden bg-[var(--bg-page)]"
      style={{ background: 'var(--bg-page, #F4F6FB)' }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <aside className="hidden md:flex w-sidebar flex-col border-r border-border-lt bg-card p-4">
        <div className="h-10 w-32 rounded-xl bg-muted mb-6 animate-pulse" />
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-9 rounded-xl bg-muted" style={{ width: `${70 + (i % 3) * 10}%` }} />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-topbar border-b border-border-lt bg-card px-4 flex items-center justify-between">
          <div className="h-8 w-40 rounded-xl bg-muted animate-pulse" />
          <div className="flex gap-2 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="h-8 w-24 rounded-xl bg-muted" />
          </div>
        </div>
        <main className="flex-1 p-2 md:p-2.5 lg:p-3">
          <ModuleSkeleton />
        </main>
      </div>
    </div>
  )
}

/** Lightweight route/module loading UI — keep this free of heavy UI barrel deps. */
export function ModuleSkeleton({ label = 'Loading' }: { label?: string } = {}) {
  return (
    <div className="mod-page" role="status" aria-live="polite" aria-busy="true">
      <p className="px-1 pb-3 text-sm font-semibold text-[var(--text-2)]">{label}…</p>
      <div className="animate-pulse space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-8 w-48 bg-muted rounded-lg" />
          <div className="h-10 w-32 bg-muted rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-muted rounded-2xl" />
          ))}
        </div>
        <div className="h-12 bg-muted rounded-xl" />
        <div className="h-96 bg-muted rounded-2xl" />
      </div>
    </div>
  )
}

export default ModuleSkeleton
