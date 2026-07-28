'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'
import { getSerialMenuPlacement } from '@/lib/inventory/serial-menu-placement'

export interface SerialOption {
  id: string
  /** Serial / IMEI number. */
  label: string
  /** Extra context, e.g. barcode and location. */
  sublabel?: string
}

interface SerialMultiSelectProps {
  options: SerialOption[]
  /** How many more serials the line can take (qty − already assigned). */
  maxSelectable: number
  onAssign: (ids: string[]) => void
  disabled?: boolean
}

/**
 * Searchable multi-select for assigning serial numbers to a document line.
 * The panel is rendered through a fixed-position portal (same anti-clipping
 * treatment as the DataTable toolbar menus) so scrolling tables and
 * overflow-hidden cards can never cut it off.
 */
export default function SerialMultiSelect({ options, maxSelectable, onAssign, disabled }: SerialMultiSelectProps) {
  const { open, position, triggerRef, menuRef, toggle, close } = useAnchoredMenu<HTMLButtonElement>()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q))
  }, [options, query])

  const openPicker = () => {
    if (!open) {
      setQuery('')
      setSelected(new Set())
    }
    toggle()
  }

  const toggleSerial = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < maxSelectable) next.add(id)
      return next
    })
  }

  const assign = () => {
    if (!selected.size) return
    onAssign(Array.from(selected))
    setSelected(new Set())
    close()
  }

  const limitReached = selected.size >= maxSelectable
  const triggerRect = open && typeof window !== 'undefined'
    ? triggerRef.current?.getBoundingClientRect()
    : null
  const placement = triggerRect
    ? getSerialMenuPlacement(triggerRect, window.innerHeight)
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn-outline px-2 py-1 text-[10px]"
        disabled={disabled || maxSelectable <= 0 || options.length === 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPicker}
      >
        {options.length === 0 ? 'No available serials' : 'Assign serials'}
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label="Assign serial numbers"
          className="dt-anchored-menu flex w-80 flex-col"
          style={{
            top: placement?.top ?? position.top,
            bottom: placement?.bottom,
            right: position.right,
            maxHeight: placement?.maxHeight,
            overflow: 'hidden',
          }}
        >
          <input
            type="text"
            autoFocus
            className="form-input mb-2 w-full flex-shrink-0 text-xs"
            placeholder="Search serial, barcode or location…"
            aria-label="Search available serials"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') assign() }}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-[var(--text-3)]">No serials match “{query}”.</p>
            )}
            {filtered.map(o => {
              const checked = selected.has(o.id)
              const blocked = !checked && limitReached
              return (
                <label
                  key={o.id}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${blocked ? 'opacity-40 cursor-not-allowed' : 'text-[var(--text-2)] hover:bg-[var(--bg-surface)] cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggleSerial(o.id)}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] text-[var(--text-1)] truncate">{o.label}</span>
                    {o.sublabel && <span className="block text-[10px] text-[var(--text-3)] truncate">{o.sublabel}</span>}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="mt-2 flex flex-shrink-0 items-center justify-between gap-2 border-t border-[var(--border-lt)] bg-[var(--bg-card)] pt-2">
            <span className="text-[10px] text-[var(--text-3)]">
              {selected.size}/{maxSelectable} selected
            </span>
            <button
              type="button"
              className="btn-primary px-3 py-1 text-[10px]"
              disabled={!selected.size}
              onClick={assign}
            >
              Assign {selected.size > 0 ? selected.size : ''}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
