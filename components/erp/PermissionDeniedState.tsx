'use client'

import type { ReactNode } from 'react'
import { StatePanel } from '@/components/ui'

export function PermissionDeniedState({
  title = 'Access denied',
  description = 'You do not have permission to view this content.',
  action,
}: {
  title?: string
  description?: string
  action?: ReactNode
}) {
  return (
    <StatePanel
      tone="error"
      title={title}
      description={description}
      action={action}
    />
  )
}
