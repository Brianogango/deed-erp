'use client'

import { createPortal } from 'react-dom'
import type { ColumnDef } from '@/lib/data-table/types'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'

interface ColumnVisibilityMenuProps<T> {
  columns: ColumnDef<T>[]
  /** Columns eligible at the current breakpoint (priority <= cap) — others can't be toggled on here. */
  eligibleKeys: Set<string>
  visibleKeys: Set<string>
  onChange: (keys: string[]) => void
}

export default function ColumnVisibilityMenu<T>({
  columns,
  eligibleKeys,
  visibleKeys,
  onChange,
}: ColumnVisibilityMenuProps<T>) {
  const { open, position, triggerRef, menuRef, toggle } = useAnchoredMenu<HTMLButtonElement>()

  const eligibleColumns = columns.filter(c => eligibleKeys.has(c.key))

  function toggleColumn(key: string) {
    const next = new Set(visibleKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(eligibleColumns.map(c => c.key).filter(k => next.has(k)))
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="dt-toolbar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose visible columns"
        title="Columns"
      >
        Columns
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Column visibility"
          className="dt-anchored-menu w-56"
          style={{ top: position.top, right: position.right }}
        >
          {eligibleColumns.map(col => (
            <label
              key={col.key}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={visibleKeys.has(col.key)}
                onChange={() => toggleColumn(col.key)}
                style={{ accentColor: 'var(--primary)' }}
              />
              {col.label}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
