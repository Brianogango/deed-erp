'use client'

import { createPortal } from 'react-dom'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'
import type { OverflowAction } from '@/lib/data-table/toolbar-types'

interface TableOverflowMenuProps {
  actions: OverflowAction[]
  label?: string
}

export default function TableOverflowMenu({ actions, label = 'More actions' }: TableOverflowMenuProps) {
  const { open, position, triggerRef, menuRef, toggle, close } = useAnchoredMenu<HTMLButtonElement>()

  if (actions.length === 0) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="dt-toolbar-btn dt-toolbar-btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="dt-anchored-menu w-56"
          style={{ top: position.top, right: position.right }}
        >
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={`dt-menu-item ${action.danger ? 'dt-menu-item-danger' : ''}`.trim()}
              onClick={() => {
                if (action.disabled) return
                action.onSelect()
                close()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
