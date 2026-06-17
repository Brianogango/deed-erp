export default function Loading() {
  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-[var(--bg-page)] animate-pulse">
      <aside className="hidden md:flex w-sidebar flex-col border-r border-border-lt bg-card p-4">
        <div className="h-10 w-32 rounded-xl bg-muted mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-9 rounded-xl bg-muted" style={{ width: `${70 + (i % 3) * 10}%` }} />
          ))}
        </div>
      </aside>
      <main className="flex-1 p-3 md:p-4 lg:p-5 xl:p-6">
        <div className="mod-page gap-4">
          <div className="mod-header">
            <div className="h-9 w-56 rounded-xl bg-muted" />
            <div className="h-9 w-28 rounded-xl bg-muted" />
          </div>
          <div className="stat-grid-4 px-4 py-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-muted" />
            ))}
          </div>
          <div className="mx-4 h-80 rounded-2xl bg-muted" />
        </div>
      </main>
    </div>
  )
}
