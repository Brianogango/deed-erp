/** Lightweight route/module loading UI — keep this free of heavy UI barrel deps. */
export function ModuleSkeleton() {
  return (
    <div className="mod-page animate-pulse">
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
  )
}

export default ModuleSkeleton
