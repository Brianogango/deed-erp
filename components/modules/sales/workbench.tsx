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
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
  ariaLabel?: string
}) {
  return (
    <div className="sp-tabs" role="tablist" aria-label={ariaLabel}>
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
    state: (i < idx ? 'done' : i === idx ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }))
}
