'use client'

export default function ModuleSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-2">
      <div className="h-8 w-48 rounded-lg bg-gray-200" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-200" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-gray-200" />
      <div className="h-48 rounded-xl bg-gray-200" />
    </div>
  )
}
