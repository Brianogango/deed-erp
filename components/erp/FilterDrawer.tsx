'use client'

import type { ReactNode } from 'react'
import { Modal } from '@/components/ui'

/**
 * Advanced filters surface.
 * Desktop/tablet: centered modal. Mobile: near full-screen sheet.
 */
export function FilterDrawer({
  open,
  onClose,
  title = 'Filters',
  children,
  footer,
  fullScreen = false,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** Stretch toward full viewport (mobile filter / more sheets). */
  fullScreen?: boolean
}) {
  if (!open) return null
  return (
    <Modal title={title} onClose={onClose} width={fullScreen ? 640 : 480}>
      <div className={`dt-sheet ${fullScreen ? 'dt-sheet-fullscreen' : ''}`.trim()}>
        <div className="dt-sheet-body">{children}</div>
        {footer && <div className="dt-sheet-footer">{footer}</div>}
      </div>
    </Modal>
  )
}
