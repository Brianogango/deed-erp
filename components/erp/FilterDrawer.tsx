'use client'

import type { ReactNode } from 'react'
import { Modal } from '@/components/ui'

/**
 * Advanced filters surface.
 * Keeps list toolbars to search + a few frequent filters.
 */
export function FilterDrawer({
  open,
  onClose,
  title = 'More filters',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <Modal title={title} onClose={onClose} width={480}>
      <div className="flex flex-col gap-4">
        {children}
        {footer && (
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-lt)]">
            {footer}
          </div>
        )}
      </div>
    </Modal>
  )
}
