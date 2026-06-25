'use client'

import { useEffect, useRef, useState } from 'react'
import type { SavedView } from '@/lib/data-table/types'

interface SavedViewsMenuProps {
  views: SavedView[]
  onApply: (view: SavedView) => void
  onSaveCurrent: (name: string) => void
  onDelete: (id: string) => void
}

export default function SavedViewsMenu({ views, onApply, onSaveCurrent, onDelete }: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setNaming(false) }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary text-[11px] px-2.5 py-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Views{views.length > 0 ? ` (${views.length})` : ''}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Saved views"
          className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 shadow-lg"
        >
          {views.length === 0 && !naming && (
            <p className="px-2 py-1.5 text-[11px] text-[var(--text-3)]">No saved views yet.</p>
          )}
          {views.map(view => (
            <div key={view.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-surface)]">
              <button
                type="button"
                className="flex-1 text-left text-xs text-[var(--text-2)]"
                onClick={() => { onApply(view); setOpen(false) }}
              >
                {view.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(view.id)}
                className="text-[var(--text-4)] hover:text-[var(--danger-text)] text-[10px] px-1"
                aria-label={`Delete view ${view.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="mt-1 border-t border-[var(--border-lt)] pt-1.5">
            {naming ? (
              <div className="flex items-center gap-1.5 px-1">
                <input
                  autoFocus
                  className="form-input text-xs flex-1"
                  placeholder="View name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && name.trim()) {
                      onSaveCurrent(name.trim())
                      setName('')
                      setNaming(false)
                      setOpen(false)
                    }
                  }}
                />
                <button
                  type="button"
                  className="text-[10px] font-bold text-[var(--primary)]"
                  onClick={() => {
                    if (!name.trim()) return
                    onSaveCurrent(name.trim())
                    setName('')
                    setNaming(false)
                    setOpen(false)
                  }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="w-full text-left px-2 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--bg-surface)] rounded-lg"
                onClick={() => setNaming(true)}
              >
                + Save current view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
