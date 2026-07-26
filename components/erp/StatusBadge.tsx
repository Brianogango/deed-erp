'use client'

import { Badge } from '@/components/ui'

/**
 * Canonical status display for every ERP module.
 * Wraps shared Badge so modules stop inventing local colour maps.
 */
export function StatusBadge({
  status,
  label,
  size = 'sm',
}: {
  status: string
  label?: string
  size?: 'xs' | 'sm'
}) {
  return <Badge status={status} label={label} size={size} />
}
