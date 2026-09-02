'use client'

import type { ReactNode } from 'react'
import { FormField, WorkflowStageBar } from '@/components/erp'
import '@/components/sales-prototype/sales-prototype.css'
import '@/components/modules/odoo-record-designs.css'

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
  blocker,
}: {
  steps: Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>
  blocker?: string | null
}) {
  const current = steps.find(step => step.state === 'current')?.key
    ?? [...steps].reverse().find(step => step.state === 'done')?.key
    ?? steps[0]?.key
    ?? ''

  if (!steps.length) return null

  return (
    <WorkflowStageBar
      stages={steps.map(step => ({ id: step.key, label: step.label }))}
      current={current}
      blocker={blocker}
      className="sales-workflow-stagebar"
    />
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
    <FormField label={label} htmlFor={htmlFor} className="sp-field">
      {children}
    </FormField>
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
 * Customer-facing Sales Order journey. Keep internal warehouse states inside
 * Delivery; Sales only exposes the milestones a salesperson must understand.
 */
export function buildSoWorkflowSteps(input: {
  hasDelivery: boolean
  deliveryPrepared: boolean
  deliveryDone: boolean
  invoiced: boolean
  paid?: boolean
  complete?: boolean
}): Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }> {
  const keys = [
    { key: 'confirmed', label: 'Order confirmed' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'invoice', label: 'Invoice' },
    { key: 'payment', label: 'Payment' },
    { key: 'complete', label: 'Complete' },
  ] as const

  let idx = 0
  if (input.complete) idx = 4
  else if (input.paid) idx = 4
  else if (input.invoiced) idx = 3
  else if (input.deliveryDone) idx = 2
  else if (input.hasDelivery || input.deliveryPrepared) idx = 1

  return keys.map((k, i) => ({
    key: k.key,
    label: k.label,
    state: (i < idx ? 'done' : i === idx ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }))
}
