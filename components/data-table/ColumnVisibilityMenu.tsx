'use client'

import { useEffect, useRef, useState } from 'react'
import type { ColumnDef } from '@/lib/data-table/types'

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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const eligibleColumns = columns.filter(c => eligibleKeys.has(c.key))

  function toggle(key: string) {
    const next = new Set(visibleKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(eligibleColumns.map(c => c.key).filter(k => next.has(k)))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary text-[11px] px-2.5 py-1.5 flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose visible columns"
      >
        Columns
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Column visibility"
          className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 shadow-lg"
        >
          {eligibleColumns.map(col => (
            <label
              key={col.key}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={visibleKeys.has(col.key)}
                onChange={() => toggle(col.key)}
                style={{ accentColor: 'var(--primary)' }}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
