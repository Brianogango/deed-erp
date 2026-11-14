// ── SOP Documents ───────────────────────────────────────────────────────────
export interface SOPDocStep {
  id: string
  order: number
  instruction: string
  note?: string
}

export interface SOPDocument {
  id: string
  title: string
  category: string
  department: string           // department grouping e.g. 'repairs', 'sales', 'hr'
  purpose: string
  scope: string
  steps: SOPDocStep[]
  tags: string[]
  version: string
  status: 'draft' | 'active' | 'archived'
  reviewDate?: string
  // File attachment (stored separately via /api/sop-files/[sopId])
  fileName?: string            // original file name e.g. 'Repair-Intake-SOP-v1.pdf'
  fileType?: string            // MIME type e.g. 'application/pdf'
  fileSize?: number            // bytes — used for display only
  createdByName: string
  createdAt: string
  updatedAt: string
}

export type SOPTargetDir = 'min' | 'max'

// Manually entered actual values for custom (non-auto) metrics
export interface SOPActual {
  id: string
  sopId: string
  metricId: string
  periodKey: string    // "2026-04" / "2026-W16" / "2026-Q2"
  actual: number
  notes?: string
  updatedByUserId: string
  updatedByName: string
  updatedDate: string
}


// ── SOPs / Performance Targets ───────────────────────────────────────────────
export const SOP_METRIC_TYPES = [
  { value: 'repairs_completed',  label: 'Repairs Completed',     unit: 'repairs', auto: true,  hint: 'Closed/delivered repairs assigned to this user in the period' },
  { value: 'repairs_diagnosed',  label: 'Repairs Diagnosed',     unit: 'repairs', auto: true,  hint: 'Repairs where diagnosis was logged by this user in the period' },
  { value: 'repairs_received',   label: 'Repairs Received',      unit: 'repairs', auto: true,  hint: 'New repair orders received in the period' },
  { value: 'outsource_sent',     label: 'Outsource Jobs Sent',   unit: 'jobs',    auto: true,  hint: 'Outsource jobs dispatched by this user in the period' },
  { value: 'sales_orders',       label: 'Sales Orders Closed',   unit: 'orders',  auto: true,  hint: 'Confirmed/delivered/invoiced orders created by this user in the period' },
  { value: 'sales_revenue',      label: 'Sales Revenue (KSh)',   unit: 'KSh',     auto: true,  hint: 'Total revenue from orders created by this user in the period' },
  { value: 'quotes_created',     label: 'Quotes Created',        unit: 'quotes',  auto: true,  hint: 'New quotations created by this user in the period' },
  { value: 'expenses_amount',    label: 'Expense Budget (KSh)',  unit: 'KSh',     auto: true,  hint: 'Total expense amount submitted by this user — should stay within target' },
  { value: 'expenses_count',     label: 'Expense Claims Filed',  unit: 'claims',  auto: true,  hint: 'Number of expense claims submitted in the period' },
  { value: 'leave_days',         label: 'Leave Days Taken',      unit: 'days',    auto: true,  hint: 'Approved leave days taken in the period' },
  { value: 'custom',             label: 'Custom / Manual',       unit: '',        auto: false, hint: 'Manually tracked metric — user or admin updates the actual value' },
] as const

export type SOPMetricType = typeof SOP_METRIC_TYPES[number]['value']

// 'min' = actual must reach or exceed target (e.g. 200 sales)
// 'max' = actual must not exceed target (e.g. expenses ≤ budget)

export interface SOPMetric {
  id: string
  label: string
  metricType: SOPMetricType
  target: number
  unit: string
  targetDir: SOPTargetDir
}

export interface SOP {
  id: string
  userId: string
  userName: string
  period: 'monthly' | 'weekly' | 'quarterly'
  metrics: SOPMetric[]
  active: boolean
  notes?: string
  createdByUserId: string
  createdByName: string
  createdAt: string
}
