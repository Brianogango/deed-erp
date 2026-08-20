'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SearchablePickOption = {
  id: string
  label: string
}

/**
 * Search-then-pick combobox for long operational lists (serials, RAM, SSD).
 * The menu is portalled so overflow on the bench form cannot clip it.
 */
export default function SearchablePick({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  disabled = false,
}: {
  label: string
  value: string
  options: SearchablePickOption[]
  onChange: (id: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  const selected = options.find(option => option.id === value)
  const display = open ? query : (selected?.label || '')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 80)
    return options
      .filter(option => option.label.toLowerCase().includes(q))
      .slice(0, 80)
  }, [options, query])

  const placeMenu = () => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, Math.min(320, openUp ? spaceAbove : spaceBelow))
    setMenuPos({
      top: openUp ? rect.top - maxHeight - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      maxHeight,
    })
  }

  const openMenu = () => {
    if (disabled) return
    setQuery('')
    setActiveIndex(0)
    placeMenu()
    setOpen(true)
  }

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
  }

  const pick = (id: string) => {
    onChange(id)
    closeMenu()
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }
    const onViewport = () => closeMenu()
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0)
  }, [filtered.length, activeIndex])

  return (
    <div ref={wrapRef} className="block text-sm">
      <span className="text-[var(--text-2)]">{label}</span>
      <div className="relative mt-1">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          className="form-input w-full pr-16"
          placeholder={placeholder}
          value={display}
          onChange={e => {
            if (!open) openMenu()
            setQuery(e.target.value)
            setActiveIndex(0)
            if (value) onChange('')
          }}
          onFocus={openMenu}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) openMenu()
              setActiveIndex(i => Math.min(filtered.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex(i => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && open) {
              e.preventDefault()
              const option = filtered[activeIndex]
              if (option) pick(option.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              closeMenu()
            }
          }}
        />
        {value && !disabled && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"
            onClick={() => {
              onChange('')
              setQuery('')
              inputRef.current?.focus()
              openMenu()
            }}
          >
            Clear
          </button>
        )}
      </div>
      {open && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="fixed z-[80] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-card)] shadow-lg"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
          }}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--text-3)]">{emptyText}</p>
          ) : filtered.map((option, index) => {
            const active = index === activeIndex
            const chosen = option.id === value
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={chosen}
                className={`block w-full truncate px-3 py-2 text-left text-sm ${
                  active ? 'bg-[var(--bg-muted)] text-[var(--text-1)]' : 'text-[var(--text-1)]'
                } ${chosen ? 'font-medium' : 'font-normal'}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(option.id)}
              >
                {option.label}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
