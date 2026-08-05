/**
 * Pure state-machine helpers for Device Reconfiguration work orders.
 */

import type { ReconfigStatus } from './types'
import { ACTIVE_RECONFIG_STATUSES } from './types'

export type ReconfigTransition =
  | 'submit_stock_check'
  | 'reserve'
  | 'release_to_draft'
  | 'submit_approval'
  | 'auto_approve'
  | 'approve'
  | 'reject'
  | 'start'
  | 'submit_qa'
  | 'qa_fail'
  | 'complete'
  | 'cancel'
  | 'reverse'

const TRANSITIONS: Record<ReconfigStatus, Partial<Record<ReconfigTransition, ReconfigStatus>>> = {
  draft: {
    submit_stock_check: 'pending_stock_check',
    cancel: 'cancelled',
  },
  pending_stock_check: {
    reserve: 'components_reserved',
    release_to_draft: 'draft',
    cancel: 'cancelled',
  },
  components_reserved: {
    submit_approval: 'pending_approval',
    auto_approve: 'approved',
    cancel: 'cancelled',
  },
  pending_approval: {
    approve: 'approved',
    reject: 'components_reserved',
    cancel: 'cancelled',
  },
  approved: {
    start: 'in_progress',
    cancel: 'cancelled',
  },
  in_progress: {
    submit_qa: 'pending_qa',
    cancel: 'cancelled',
  },
  pending_qa: {
    complete: 'completed',
    qa_fail: 'in_progress',
  },
  completed: {
    reverse: 'reversed',
  },
  cancelled: {},
  reversed: {},
}

export function canTransition(from: ReconfigStatus, action: ReconfigTransition): boolean {
  return Boolean(TRANSITIONS[from]?.[action])
}

export function nextStatus(from: ReconfigStatus, action: ReconfigTransition): ReconfigStatus {
  const next = TRANSITIONS[from]?.[action]
  if (!next) {
    throw new Error(`Invalid reconfiguration transition: ${from} → ${action}`)
  }
  return next
}

export function isActiveReconfigStatus(status: ReconfigStatus): boolean {
  return ACTIVE_RECONFIG_STATUSES.includes(status)
}

export function isMutableDraftStatus(status: ReconfigStatus): boolean {
  return status === 'draft' || status === 'pending_stock_check'
}

export function assertVersion(current: number, expected: number) {
  if (current !== expected) {
    const err = new Error('Work order was modified by another user. Reload and try again.')
    ;(err as Error & { status: number }).status = 409
    throw err
  }
}
