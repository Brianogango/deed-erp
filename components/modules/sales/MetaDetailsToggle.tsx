'use client'
// Split out of components/modules/Sales.tsx. Moved verbatim.

/** "More details" for a sales record's folded fields — phones only (phone-fit.css). */
export function MetaDetailsToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="sales-meta-toggle" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? 'Fewer details' : 'More details'}
    </button>
  )
}
