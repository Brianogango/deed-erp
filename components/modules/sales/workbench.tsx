'use client'

import type { ReactNode } from 'react'

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

export function SalesDocPill({ label, tone }: { label: string; tone: SalesDocPillTone }) {
  return <span className={`sales-doc-pill sales-doc-pill--${tone}`}>{label}</span>
}

export function SalesDocTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Document sections',
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
  ariaLabel?: string
}) {
  return (
    <div className="sales-doc-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="sales-doc-tab"
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
}: {
  rows: Array<{ label: string; value: string; grand?: boolean }>
}) {
  return (
    <div className="sales-doc-totals" aria-label="Document totals">
      {rows.map(row => (
        <div key={row.label} className={`sales-doc-totals-row${row.grand ? ' grand' : ''}`}>
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
    <div className="sales-doc-workflow" role="list" aria-label="Sales workflow progress">
      {steps.map(step => (
        <div
          key={step.key}
          className="sales-doc-workflow-step"
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
    <div className="sales-doc-field">
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
      return { label: 'Sent', tone: 'sent' }
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
      return { label: 'Picking', tone: 'info' }
    case 'done':
      return { label: 'Delivered', tone: 'success' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'danger' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

/** SO fulfillment workflow bar from delivery + invoice state. */
export function buildSoWorkflowSteps(input: {
  hasDelivery: boolean
  deliveryPrepared: boolean
  deliveryDone: boolean
  invoiced: boolean
  paid: boolean
}): Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }> {
  const keys = [
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'reserved', label: 'Reserved' },
    { key: 'ready', label: 'Ready to Deliver' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'invoiced', label: 'Invoiced' },
    { key: 'paid', label: 'Paid' },
  ] as const
  let idx = 0
  if (input.paid) idx = 5
  else if (input.invoiced) idx = 4
  else if (input.deliveryDone) idx = 3
  else if (input.deliveryPrepared) idx = 2
  else if (input.hasDelivery) idx = 1
  else idx = 0
  return keys.map((k, i) => ({
    key: k.key,
    label: k.label,
    state: i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }))
}
