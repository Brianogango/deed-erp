'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Fa, faFileExport } from '@/components/icons'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'
import type { ExportMenuOption } from '@/lib/data-table/toolbar-types'

interface ExportMenuProps {
  options: ExportMenuOption[]
  disabled?: boolean
  label?: string
}

export default function ExportMenu({ options, disabled, label = 'Export' }: ExportMenuProps) {
  const { open, position, triggerRef, menuRef, toggle, close } = useAnchoredMenu<HTMLButtonElement>()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (options.length === 0) return null

  async function run(option: ExportMenuOption) {
    if (option.disabled || busyId) return
    setBusyId(option.id)
    try {
      await option.onSelect()
      close()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled || Boolean(busyId)}
        className="dt-toolbar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} options`}
        title={label}
      >
        <Fa icon={faFileExport} className="dt-toolbar-icon" aria-hidden="true" />
        <span>{busyId ? 'Exporting…' : label}</span>
        <span className="dt-toolbar-caret" aria-hidden="true">▾</span>
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Export options"
          className="dt-anchored-menu w-48"
          style={{ top: position.top, right: position.right }}
        >
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              disabled={option.disabled || Boolean(busyId)}
              className="dt-menu-item"
              onClick={() => { void run(option) }}
            >
              {busyId === option.id ? 'Working…' : option.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
