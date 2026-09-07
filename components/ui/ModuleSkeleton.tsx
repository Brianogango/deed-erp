type SkeletonBlockProps = {
  className?: string
}

/** Keeps every placeholder visually consistent without importing the heavy UI barrel. */
function SkeletonBlock({ className = '' }: SkeletonBlockProps) {
  return <div aria-hidden="true" className={`rounded-lg bg-muted ${className}`} />
}

function ContentSkeleton({ label }: { label: string }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-44 sm:w-56" />
          <SkeletonBlock className="h-3 w-64 max-w-[70vw]" />
        </div>
        <SkeletonBlock className="h-10 w-28 sm:w-36 rounded-xl" />
      </div>

      <div className="flex flex-col items-center justify-center gap-2 py-1">
        <span
          aria-hidden="true"
          className="h-7 w-7 rounded-full border-[3px] border-[var(--border-lt)] border-t-[var(--primary)] animate-spin"
        />
        <p className="text-center text-sm font-semibold text-[var(--text-2)]">{label}…</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="rounded-xl border border-[var(--border-lt)] bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="h-6 w-28" />
              </div>
              <SkeletonBlock className="h-9 w-9 rounded-xl" />
            </div>
            <SkeletonBlock className="mt-4 h-3 w-20" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-lt)] bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_160px_160px_44px]">
          <SkeletonBlock className="h-10 w-full rounded-xl" />
          <SkeletonBlock className="h-10 w-full rounded-xl" />
          <SkeletonBlock className="h-10 w-full rounded-xl" />
          <SkeletonBlock className="h-10 w-11 rounded-xl" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-lt)] bg-card">
        <div className="grid grid-cols-[32px_1.4fr_1fr_1fr_.8fr] gap-4 border-b border-[var(--border-lt)] bg-[var(--bg-subtle)] px-4 py-3">
          <SkeletonBlock className="h-3 w-4" />
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-3 w-16" />
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-[32px_1.4fr_1fr_1fr_.8fr] gap-4 border-b border-[var(--border-lt)] px-4 py-3 last:border-b-0"
          >
            <SkeletonBlock className="h-4 w-4 rounded" />
            <SkeletonBlock className={`h-4 ${row % 2 === 0 ? 'w-4/5' : 'w-3/5'}`} />
            <SkeletonBlock className={`h-4 ${row % 3 === 0 ? 'w-3/4' : 'w-1/2'}`} />
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
        ))}
      </div>
    </>
  )
}

/** Full-viewport chrome placeholder so the first paint is never a blank screen. */
export function ShellChromeSkeleton() {
  return (
    <div
      className="flex h-screen w-full overflow-hidden bg-[var(--bg-page)]"
      style={{ background: 'var(--bg-page, #F4F6FB)' }}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Preparing your workspace"
    >
      <aside
        className="hidden w-sidebar flex-col border-r border-white/10 p-4 md:flex"
        style={{ background: 'var(--navy, #20164D)' }}
      >
        <div className="animate-pulse">
          <div className="mb-7 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/20" />
            <div className="space-y-2">
              <div className="h-4 w-24 rounded bg-white/30" />
              <div className="h-2 w-16 rounded bg-white/15" />
            </div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="flex h-10 items-center gap-3 rounded-xl px-2">
                <div className="h-5 w-5 rounded bg-white/20" />
                <div className="h-3 rounded bg-white/20" style={{ width: `${76 + (index % 3) * 12}px` }} />
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-topbar items-center justify-between border-b border-border-lt bg-card px-4">
          <SkeletonBlock className="h-9 w-48 sm:w-80 rounded-xl animate-pulse" />
          <div className="flex items-center gap-3 animate-pulse">
            <SkeletonBlock className="h-8 w-8 rounded-full" />
            <SkeletonBlock className="h-8 w-8 rounded-full" />
            <SkeletonBlock className="hidden h-8 w-24 rounded-xl sm:block" />
          </div>
        </div>
        <main className="min-h-0 flex-1 overflow-hidden p-2 md:p-2.5 lg:p-3">
          <div className="mod-page animate-pulse">
            <ContentSkeleton label="Preparing your workspace" />
          </div>
        </main>
      </div>
    </div>
  )
}

/** Lightweight route/module loading UI; the mounted AppShell remains visible. */
export function ModuleSkeleton({ label = 'Loading' }: { label?: string } = {}) {
  return (
    <div
      className="mod-page animate-pulse"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`${label} content is loading`}
    >
      <ContentSkeleton label={label} />
    </div>
  )
}

export default ModuleSkeleton
