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
