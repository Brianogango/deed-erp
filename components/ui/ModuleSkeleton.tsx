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
