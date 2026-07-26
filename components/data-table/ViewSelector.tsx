'use client'

import type { LayoutViewsConfig } from '@/lib/data-table/toolbar-types'

interface ViewSelectorProps {
  views: LayoutViewsConfig
}

/** Compact layout switcher (table / kanban / calendar). Not saved-column views. */
export default function ViewSelector({ views }: ViewSelectorProps) {
  if (views.options.length < 2) return null

  return (
    <div className="dt-view-selector" role="group" aria-label="Layout view">
      {views.options.map(option => {
        const active = views.value === option.id
        return (
          <button
            key={option.id}
            type="button"
            className={`dt-view-btn ${active ? 'is-active' : ''}`.trim()}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => views.onChange(option.id)}
          >
            {option.icon ?? option.label}
          </button>
        )
      })}
    </div>
  )
}
