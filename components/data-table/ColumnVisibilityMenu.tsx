'use client'

import { createPortal } from 'react-dom'
import { Fa, faEllipsisVertical } from '@/components/icons'
import type { ColumnDef } from '@/lib/data-table/types'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'

interface ColumnVisibilityMenuProps<T> {
  columns: ColumnDef<T>[]
  /** Columns the user may toggle on/off (typically every priority ≤ 3 column). */
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
    if (next.has(key)) {
      // Keep at least two columns so the table never collapses to empty.
      if (next.size <= 2) return
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange(eligibleColumns.map(c => c.key).filter(k => next.has(k)))
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="dt-toolbar-btn dt-toolbar-btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose visible columns"
        title="Show or hide columns"
      >
        <Fa icon={faEllipsisVertical} className="dt-toolbar-icon" aria-hidden="true" />
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Column visibility"
          className="dt-anchored-menu w-56"
          style={{ top: position.top, right: position.right }}
        >
          <div className="mb-1 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[var(--text-4)]">
            Columns
          </div>
          {eligibleColumns.map(col => {
            const locked = col.priority === 1
            return (
              <label
                key={col.key}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visibleKeys.has(col.key)}
                  disabled={locked}
                  onChange={() => { if (!locked) toggleColumn(col.key) }}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="min-w-0 flex-1 truncate">{col.label}</span>
                {locked && <span className="text-[9px] font-bold text-[var(--text-4)]">Required</span>}
              </label>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
