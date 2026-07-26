'use client'

/**
 * Compact operational counters for list pages.
 * Plain inline text — not filter chips or KPI cards.
 */
export function OperationalSummary({
  items,
}: {
  items: Array<{
    id: string
    label: string
    value: number | string
    tone?: 'default' | 'warning' | 'danger' | 'success'
    onClick?: () => void
  }>
}) {
  if (items.length === 0) return null
  return (
    <ul className="erp-ops-summary" aria-label="Operational summary">
      {items.map((item, index) => (
        <li key={item.id} className="erp-ops-summary-item">
          {index > 0 && <span className="erp-ops-summary-sep" aria-hidden="true">·</span>}
          {item.onClick ? (
            <button
              type="button"
              className={`erp-ops-summary-btn tone-${item.tone ?? 'default'}`}
              onClick={item.onClick}
            >
              <span className="erp-ops-summary-value">{item.value}</span>
              <span className="erp-ops-summary-label">{item.label}</span>
            </button>
          ) : (
            <span className={`erp-ops-summary-plain tone-${item.tone ?? 'default'}`}>
              <span className="erp-ops-summary-value">{item.value}</span>
              <span className="erp-ops-summary-label">{item.label}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
