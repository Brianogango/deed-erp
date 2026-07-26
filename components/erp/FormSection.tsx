'use client'

import { useId, useState, type ReactNode } from 'react'

/**
 * Progressive form section — required groups stay open; optional groups collapse.
 */
export function FormSection({
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
  className = '',
}: {
  title: string
  description?: string
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className={`erp-form-section ${className}`.trim()}>
      <div className="erp-form-section-head">
        {collapsible ? (
          <button
            type="button"
            className="erp-form-section-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(v => !v)}
          >
            <span>
              <span className="erp-form-section-title">{title}</span>
              {description && <span className="erp-form-section-desc">{description}</span>}
            </span>
            <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>
        ) : (
          <div>
            <h3 className="erp-form-section-title">{title}</h3>
            {description && <p className="erp-form-section-desc">{description}</p>}
          </div>
        )}
      </div>
      {(!collapsible || open) && (
        <div id={panelId} className="erp-form-section-body">
          {children}
        </div>
      )}
    </section>
  )
}
