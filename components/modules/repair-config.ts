import type { RepairStatus } from '@/lib/store'

export const STATUS_LABELS: Record<RepairStatus, string> = {
  pending_verification: 'Pending Verification', received: 'Received', assigned: 'Assigned', diagnosed: 'Diagnosed',
  awaiting_approval: 'Awaiting Approval', approved: 'Approved',
  awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair', qc: 'QC Testing', ready: 'Ready',
  verified_released: 'Verified — Awaiting Collection',
  invoiced: 'Invoiced', delivered: 'Delivered', collected: 'Collected', closed: 'Closed',
  declined: 'Quote Declined', unrepairable: 'Unrepairable', returned: 'Returned',
  retained: 'Left with Deed', cancelled: 'Cancelled',
}

export const STATUS_COLORS: Record<RepairStatus, string> = {
  pending_verification: '#F59E0B', received: '#9CA3AF', assigned: '#3B82F6', diagnosed: '#06B6D4',
  awaiting_approval: '#F59E0B', approved: '#10B981', awaiting_parts: '#F97316',
  in_repair: '#8B5CF6', qc: '#EC4899', ready: '#10B981',
  verified_released: '#7C3AED',
  invoiced: '#F59E0B', delivered: '#0D9488', collected: '#059669', closed: '#6B7280',
  declined: '#DC2626', unrepairable: '#991B1B', returned: '#78716C', retained: '#57534E', cancelled: '#EF4444',
}

export const STEPPER_STEPS: RepairStatus[] = [
  'pending_verification', 'received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'verified_released', 'collected', 'closed'
]
