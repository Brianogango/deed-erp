'use client'

/**
 * Compact operational counters for list pages.
 * Use instead of charts above operational tables.
 */
export function OperationalSummary({
  items,
}: {
  items: Array<{ id: string; label: string; value: number | string; tone?: 'default' | 'warning' | 'danger' | 'success' }>
}) {
  if (items.length === 0) return null
  return (
    <ul className="erp-ops-summary" aria-label="Operational summary">
      {items.map(item => (
        <li key={item.id} className={`erp-ops-summary-item tone-${item.tone ?? 'default'}`}>
          <span className="erp-ops-summary-value">{item.value}</span>
          <span className="erp-ops-summary-label">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
