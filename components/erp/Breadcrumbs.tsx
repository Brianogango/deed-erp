'use client'

export type BreadcrumbItem = {
  label: string
  onClick?: () => void
}

/**
 * Odoo-style breadcrumb trail — intermediate items are links; the last item is plain text.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items.length) return null

  return (
    <nav className="erp-breadcrumbs" aria-label="Breadcrumb">
      <ol className="erp-breadcrumbs-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="erp-breadcrumb-item">
              {index > 0 && (
                <span className="erp-breadcrumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {isLast || !item.onClick ? (
                <span
                  className={isLast ? 'erp-breadcrumb-current' : 'erp-breadcrumb-text'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <button type="button" className="erp-breadcrumb-link" onClick={item.onClick}>
                  {item.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
