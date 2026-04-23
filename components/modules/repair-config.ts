import type { RepairStatus } from '@/lib/store'

export const STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'Received', assigned: 'Assigned', diagnosed: 'Diagnosed',
  awaiting_approval: 'Awaiting Approval', approved: 'Approved',
  awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair', qc: 'QC Testing', ready: 'Ready',
  invoiced: 'Invoiced', delivered: 'Delivered', closed: 'Closed',
  declined: 'Quote Declined', unrepairable: 'Unrepairable', returned: 'Returned', cancelled: 'Cancelled',
}

export const STATUS_COLORS: Record<RepairStatus, string> = {
  received: '#9CA3AF', assigned: '#3B82F6', diagnosed: '#06B6D4',
  awaiting_approval: '#F59E0B', approved: '#10B981', awaiting_parts: '#F97316',
  in_repair: '#8B5CF6', qc: '#EC4899', ready: '#10B981', invoiced: '#F59E0B',
  delivered: '#0D9488', closed: '#6B7280',
  declined: '#DC2626', unrepairable: '#991B1B', returned: '#78716C', cancelled: '#EF4444',
}
