'use client'

import type { ReactNode } from 'react'
import '@/components/sales-prototype/sales-prototype.css'

export type SalesDocPillTone =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'confirmed'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'info'
  | 'success'

const PILL_MAP: Record<SalesDocPillTone, string> = {
  draft: 'grey',
  sent: 'blue',
  accepted: 'green',
  confirmed: 'green',
  warning: 'amber',
  danger: 'red',
  neutral: 'grey',
  info: 'blue',
  success: 'green',
}

export function SalesDocPill({ label, tone }: { label: string; tone: SalesDocPillTone }) {
  return <span className={`sp-pill sp-pill-${PILL_MAP[tone]}`}>{label}</span>
}

export function SalesDocTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Document sections',
  className = '',
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div className={`sp-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="sp-tab"
          aria-selected={active === tab}
          data-active={active === tab ? 'true' : 'false'}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

export function SalesDocTotals({
  rows,
  sticky,
}: {
  rows: Array<{ label: string; value: string; grand?: boolean }>
  sticky?: boolean
}) {
  return (
    <div className={`sp-totals${sticky ? ' sticky' : ''}`} aria-label="Document totals">
      {rows.map(row => (
        <div key={row.label} className={`sp-totals-row${row.grand ? ' grand' : ''}`}>
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function SalesDocWorkflow({
  steps,
}: {
  steps: Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>
}) {
  return (
    <div className="sp-workflow" role="list" aria-label="Sales workflow progress">
      {steps.map(step => (
        <div
          key={step.key}
          className="sp-workflow-step"
          role="listitem"
          data-state={step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {step.label}
        </div>
      ))}
    </div>
  )
}

export type OdooRecordStatusStep = {
  key: string
  label: string
}

export function OdooRecordStatusBar({
  steps,
  activeKey,
  ariaLabel = 'Document status',
}: {
  steps: OdooRecordStatusStep[]
  activeKey: string
  ariaLabel?: string
}) {
  const activeIndex = Math.max(0, steps.findIndex(step => step.key === activeKey))
  return (
    <div className="odoo-record-status" role="list" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <div
          key={step.key}
          className="odoo-record-status__step"
          data-state={index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'todo'}
          role="listitem"
          aria-current={index === activeIndex ? 'step' : undefined}
        >
          <span className="odoo-record-status__marker" aria-hidden="true">
            {index < activeIndex ? '✓' : index + 1}
          </span>
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  )
}

export type OdooSmartButtonItem = {
  label: string
  value: ReactNode
  onClick?: () => void
  emphasis?: boolean
}

export function OdooSmartButtons({
  items,
  ariaLabel = 'Related records',
}: {
  items: OdooSmartButtonItem[]
  ariaLabel?: string
}) {
  return (
    <div className="odoo-smart-buttons" aria-label={ariaLabel}>
      {items.map(item => item.onClick ? (
        <button
          key={item.label}
          type="button"
          className="odoo-smart-button"
          data-emphasis={item.emphasis ? 'true' : 'false'}
          onClick={item.onClick}
        >
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </button>
      ) : (
        <div
          key={item.label}
          className="odoo-smart-button"
          data-emphasis={item.emphasis ? 'true' : 'false'}
        >
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

export function SalesDocField({
  label,
  children,
  htmlFor,
}: {
  label: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="sp-field">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <label>{label}</label>}
      {children}
    </div>
  )
}

export function saleStatusPill(status: string): { label: string; tone: SalesDocPillTone } {
  switch (status) {
    case 'quotation':
      return { label: 'Draft', tone: 'draft' }
    case 'quotation_sent':
      return { label: 'Sent', tone: 'warning' }
    case 'sale':
      return { label: 'Confirmed', tone: 'confirmed' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'danger' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function deliveryStatusPill(status: string): { label: string; tone: SalesDocPillTone } {
  switch (status) {
    case 'draft':
    case 'waiting':
      return { label: 'Waiting', tone: 'warning' }
    case 'ready':
      return { label: 'Ready', tone: 'success' }
    case 'done':
      return { label: 'Delivered', tone: 'success' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'danger' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

/**
 * Operational fulfilment/billing stepper. Payment is intentionally excluded —
 * it stays a separate dimension (see payment status pills on the SO header).
 */
export function buildSoWorkflowSteps(input: {
  hasDelivery: boolean
  deliveryPrepared: boolean
  deliveryDone: boolean
  invoiced: boolean
  complete?: boolean
}): Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }> {
  const keys = [
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'reserved', label: 'Reserved' },
    { key: 'ready', label: 'Ready to Deliver' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'invoiced', label: 'Invoiced' },
    { key: 'complete', label: 'Complete' },
  ] as const
  let idx = 0
  if (input.complete) idx = 5
  else if (input.invoiced) idx = 4
  else if (input.deliveryDone) idx = 3
  else if (input.deliveryPrepared) idx = 2
  else if (input.hasDelivery) idx = 1
  else idx = 0
  return keys.map((k, i) => ({
    key: k.key,
    label: k.label,
    state: (i < idx ? 'done' : i === idx ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }))
}
