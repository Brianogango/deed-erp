'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { SavedView } from '@/lib/data-table/types'
import { useAnchoredMenu } from '@/lib/data-table/use-anchored-menu'

interface SavedViewsMenuProps {
  views: SavedView[]
  onApply: (view: SavedView) => void
  onSaveCurrent: (name: string) => void
  onDelete: (id: string) => void
}

export default function SavedViewsMenu({ views, onApply, onSaveCurrent, onDelete }: SavedViewsMenuProps) {
  const { open, position, triggerRef, menuRef, toggle, close } = useAnchoredMenu<HTMLButtonElement>()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const closeMenu = () => {
    close()
    setNaming(false)
  }

  const saveCurrent = () => {
    if (!name.trim()) return
    onSaveCurrent(name.trim())
    setName('')
    closeMenu()
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
        aria-label="Saved views"
      >
        Saved views{views.length > 0 ? ` (${views.length})` : ''}
      </button>
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Saved views"
          className="dt-anchored-menu w-60"
          style={{ top: position.top, right: position.right }}
        >
          {views.length === 0 && !naming && (
            <p className="px-2 py-1.5 text-[11px] text-[var(--text-3)]">No saved views yet.</p>
          )}
          {views.map(view => (
            <div key={view.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-surface)]">
              <button
                type="button"
                className="flex-1 text-left text-xs text-[var(--text-2)]"
                onClick={() => { onApply(view); closeMenu() }}
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
                  aria-label="New view name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveCurrent()
                  }}
                />
                <button type="button" className="text-[10px] font-bold text-[var(--primary)]" onClick={saveCurrent}>
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
        </div>,
        document.body,
      )}
    </>
  )
}
